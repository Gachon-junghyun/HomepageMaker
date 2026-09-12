import { ipcRenderer } from 'electron'
import type { ElementInfo, TreeNode } from '../shared/types'

/**
 * <webview> 안(=사용자 홈페이지) 에 들어가는 오버레이. 피그마의 «캔버스 위 손»을 DOM 위에 흉내 낸다.
 *
 *  · 호버 = 파란 얇은 테두리 + 이름표(태그.클래스 · W×H)      (Figma: hover outline)
 *  · 클릭 = 선택. 파란 2px + 모서리 핸들 + 크기 배지           (Figma: selection)
 *  · 선택된 요소의 padding(초록)·margin(주황) 을 칠한다         (DevTools box model — Figma 의 auto-layout 패딩 표시와 같은 정보)
 *  · Alt 누른 채 호버 = 선택 요소와 호버 요소 사이 거리(빨간 선 + px)   (Figma: alt-measure)
 *  · 방향키 = ↑부모 ↓첫 자식 ←→ 형제  / Esc = 선택 해제 / 같은 요소 재클릭 = 부모로   (Figma: Enter/Shift+Enter 로 들어가고 나오기)
 *  · React 컴포넌트 경로를 fiber 에서 읽는다 — 그래서 contextIsolation 을 끈다.
 *    (isolated world 에서는 DOM 노드의 `__reactFiber$` 확장 속성이 안 보인다. 그 하나 때문이다.)
 *
 * 호스트(앱 창)와는 ipcRenderer.sendToHost / ipcRenderer.on('hm') 으로만 말한다. 페이지 스크립트에 아무것도 노출하지 않는다.
 */

const NS = '__hm'
let selectMode = true
let altDown = false
let hovered: Element | null = null
let selected: Element | null = null
let selectedPath = ''
/**
 * 🔴 함께 고른 것들 (PPT 의 Shift+클릭). `selected` 는 그중 «주 선택»이다 —
 *    손잡이·정렬 기준·디자인 패널이 전부 주 선택을 본다. PPT 와 같은 규칙이다.
 */
let alsoSelected: Element[] = []
const allSelected = (): Element[] => (selected ? [selected, ...alsoSelected] : [])

/* ---------- id 부여 ---------- */
const idOf = new WeakMap<Element, string>()
const byId = new Map<string, WeakRef<Element>>()
let seq = 0
function hmId(el: Element): string {
  let id = idOf.get(el)
  if (!id) { id = 'e' + (++seq).toString(36); idOf.set(el, id); byId.set(id, new WeakRef(el)) }
  return id
}
function elOf(id: string): Element | null {
  const el = byId.get(id)?.deref()
  return el && el.isConnected ? el : null
}

/* ---------- 오버레이 DOM ---------- */
let root: HTMLDivElement
let hoverBox: HTMLDivElement, hoverTip: HTMLDivElement
let selBox: HTMLDivElement, selTip: HTMLDivElement
let padBox: HTMLDivElement[] = [], marBox: HTMLDivElement[] = []
let measureLayer: HTMLDivElement
let snapLayer: HTMLDivElement
let multiLayer: HTMLDivElement

function mk(cls: string, style: string): HTMLDivElement {
  const d = document.createElement('div')
  d.className = NS + ' ' + cls
  d.setAttribute('style', 'position:fixed;pointer-events:none;box-sizing:border-box;' + style)
  root.appendChild(d)
  return d
}

function mount(): void {
  if (document.getElementById(NS)) return
  root = document.createElement('div')
  root.id = NS
  root.setAttribute('style', 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:11px/1.4 ui-sans-serif,system-ui,sans-serif;')
  document.documentElement.appendChild(root)
  const tip = 'padding:2px 6px;border-radius:3px;color:#fff;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;'
  for (let i = 0; i < 4; i++) marBox.push(mk('mar', 'background:rgba(246,178,107,.35);display:none'))
  for (let i = 0; i < 4; i++) padBox.push(mk('pad', 'background:rgba(147,196,125,.35);display:none'))
  hoverBox = mk('hover', 'border:1px solid #0d99ff;display:none')
  hoverTip = mk('tip', tip + 'background:#0d99ff;display:none')
  selBox = mk('sel', 'border:2px solid #0d99ff;display:none;outline:1px solid rgba(255,255,255,.6)')
  selTip = mk('tip', tip + 'background:#0d99ff;display:none;font-weight:600')
  measureLayer = mk('measure', 'inset:0;display:none')
  snapLayer = mk('snap', 'inset:0;display:none')
  multiLayer = mk('multi', 'inset:0;display:none')
  mountHandles()
}

/**
 * 선택 상자의 손잡이 — PPT·포토샵처럼 «잡아서» 크기를 바꾸고 돌린다.
 * 🔴 오버레이에서 이것만 `pointer-events:auto` 다. 나머지는 전부 통과시킨다 —
 *    안 그러면 페이지를 클릭조차 못 한다.
 */
const HANDLES: { id: string; x: number; y: number; cur: string }[] = [
  { id: 'nw', x: 0, y: 0, cur: 'nwse-resize' }, { id: 'n', x: 0.5, y: 0, cur: 'ns-resize' }, { id: 'ne', x: 1, y: 0, cur: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cur: 'ew-resize' }, { id: 'e', x: 1, y: 0.5, cur: 'ew-resize' },
  { id: 'sw', x: 0, y: 1, cur: 'nesw-resize' }, { id: 's', x: 0.5, y: 1, cur: 'ns-resize' }, { id: 'se', x: 1, y: 1, cur: 'nwse-resize' },
]

function mountHandles(): void {
  for (const h of HANDLES) {
    const d = document.createElement('div')
    d.setAttribute('style',
      `position:absolute;width:9px;height:9px;background:#fff;border:1.5px solid #0d99ff;border-radius:2px;pointer-events:auto;cursor:${h.cur};` +
      `left:calc(${h.x * 100}% - 5px);top:calc(${h.y * 100}% - 5px)`)
    d.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, 'resize', h.id), true)
    selBox.appendChild(d)
  }
  // 회전 손잡이 — 위에 떠 있는 동그라미 (PPT 와 같은 자리)
  const rot = document.createElement('div')
  rot.setAttribute('style', 'position:absolute;width:11px;height:11px;border-radius:50%;background:#fff;border:1.5px solid #0d99ff;pointer-events:auto;cursor:grab;left:calc(50% - 6px);top:-26px')
  rot.addEventListener('pointerdown', (e) => startDrag(e as PointerEvent, 'rotate', 'rotate'), true)
  selBox.appendChild(rot)
}

function place(box: HTMLDivElement, r: DOMRect): void {
  box.style.display = 'block'
  box.style.left = r.left + 'px'; box.style.top = r.top + 'px'
  box.style.width = r.width + 'px'; box.style.height = r.height + 'px'
}
function placeTip(tipEl: HTMLDivElement, r: DOMRect, text: string): void {
  tipEl.textContent = text
  tipEl.style.display = 'block'
  const above = r.top > 22
  tipEl.style.left = Math.max(0, r.left) + 'px'
  tipEl.style.top = (above ? r.top - 20 : r.bottom + 2) + 'px'
}

function label(el: Element): string {
  const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (cls.length ? '.' + cls.slice(0, 2).join('.') + (cls.length > 2 ? '…' : '') : '')
}

function px(v: string): number { return parseFloat(v) || 0 }

/** padding(안쪽)·margin(바깥쪽) 을 네 조각으로 칠한다 */
function paintBoxModel(el: Element | null): void {
  const all = [...padBox, ...marBox]
  if (!el) { all.forEach((b) => (b.style.display = 'none')); return }
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const p = [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)]
  const m = [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)]
  const set = (b: HTMLDivElement, x: number, y: number, w: number, h: number): void => {
    if (w <= 0 || h <= 0) { b.style.display = 'none'; return }
    b.style.display = 'block'; b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.width = w + 'px'; b.style.height = h + 'px'
  }
  set(padBox[0], r.left, r.top, r.width, p[0])
  set(padBox[1], r.right - p[1], r.top + p[0], p[1], r.height - p[0] - p[2])
  set(padBox[2], r.left, r.bottom - p[2], r.width, p[2])
  set(padBox[3], r.left, r.top + p[0], p[3], r.height - p[0] - p[2])
  set(marBox[0], r.left - m[3], r.top - m[0], r.width + m[1] + m[3], m[0])
  set(marBox[1], r.right, r.top, m[1], r.height)
  set(marBox[2], r.left - m[3], r.bottom, r.width + m[1] + m[3], m[2])
  set(marBox[3], r.left - m[3], r.top, m[3], r.height)
}

/** 함께 고른 것들을 얇은 상자로 (주 선택만 손잡이를 갖는다 — PPT 와 같다) */
function paintMulti(): void {
  multiLayer.innerHTML = ''
  if (!alsoSelected.length) { multiLayer.style.display = 'none'; return }
  multiLayer.style.display = 'block'
  for (const el of alsoSelected) {
    if (!el.isConnected) continue
    const r = el.getBoundingClientRect()
    const d = document.createElement('div')
    d.setAttribute('style', `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:1.5px dashed #0d99ff;background:rgba(13,153,255,.06)`)
    multiLayer.appendChild(d)
  }
}

/** 피그마의 alt-측정: 두 사각형 사이의 빈 거리를 빨간 선으로 */
function paintMeasure(a: Element | null, b: Element | null): void {
  measureLayer.innerHTML = ''
  if (!a || !b || a === b) { measureLayer.style.display = 'none'; return }
  measureLayer.style.display = 'block'
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
  const line = (x: number, y: number, w: number, h: number, text: string): void => {
    const l = document.createElement('div')
    l.setAttribute('style', `position:absolute;left:${x}px;top:${y}px;width:${Math.max(w, 1)}px;height:${Math.max(h, 1)}px;background:#f24822`)
    const t = document.createElement('div')
    t.textContent = text
    t.setAttribute('style', `position:absolute;left:${x + w / 2}px;top:${y + h / 2}px;transform:translate(-50%,-50%);background:#f24822;color:#fff;padding:1px 4px;border-radius:2px;font-size:10px;font-weight:600`)
    measureLayer.append(l, t)
  }
  // 가로 거리
  const midY = (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2
  if (rb.left >= ra.right) line(ra.right, midY, rb.left - ra.right, 1, Math.round(rb.left - ra.right) + '')
  else if (ra.left >= rb.right) line(rb.right, midY, ra.left - rb.right, 1, Math.round(ra.left - rb.right) + '')
  // 세로 거리
  const midX = (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2
  if (rb.top >= ra.bottom) line(midX, ra.bottom, 1, rb.top - ra.bottom, Math.round(rb.top - ra.bottom) + '')
  else if (ra.top >= rb.bottom) line(midX, rb.bottom, 1, ra.top - rb.bottom, Math.round(ra.top - rb.bottom) + '')
  // 안에 들어 있으면 네 변까지 거리
  const inside = (o: DOMRect, i: DOMRect): boolean => i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom
  if (inside(ra, rb) || inside(rb, ra)) {
    const [o, i] = inside(ra, rb) ? [ra, rb] : [rb, ra]
    const cx = i.left + i.width / 2, cy = i.top + i.height / 2
    line(o.left, cy, i.left - o.left, 1, Math.round(i.left - o.left) + '')
    line(i.right, cy, o.right - i.right, 1, Math.round(o.right - i.right) + '')
    line(cx, o.top, 1, i.top - o.top, Math.round(i.top - o.top) + '')
    line(cx, i.bottom, 1, o.bottom - i.bottom, Math.round(o.bottom - i.bottom) + '')
  }
}

function repaint(): void {
  if (hovered && hovered.isConnected && hovered !== selected) {
    const r = hovered.getBoundingClientRect()
    place(hoverBox, r)
    placeTip(hoverTip, r, `${label(hovered)}  ${Math.round(r.width)} × ${Math.round(r.height)}`)
  } else { hoverBox.style.display = 'none'; hoverTip.style.display = 'none' }
  if (selected && selected.isConnected) {
    const r = selected.getBoundingClientRect()
    // 🔴 회전했으면 선택 상자도 «같이» 기울여야 한다. getBoundingClientRect 는 축에 정렬된 큰 사각형을 주므로
    //    그대로 쓰면 기운 글자 주위에 헐렁한 상자가 뜬다 (PPT 는 상자가 같이 돈다).
    //    회전 «전» 크기는 offsetWidth/Height 고, 중심은 두 경우 모두 같다.
    const el = selected as HTMLElement
    const rot = xformOf(el).rot
    const w = el.offsetWidth || r.width, h = el.offsetHeight || r.height
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2
    selBox.style.display = 'block'
    selBox.style.left = `${cx - w / 2}px`; selBox.style.top = `${cy - h / 2}px`
    selBox.style.width = `${w}px`; selBox.style.height = `${h}px`
    selBox.style.transform = rot ? `rotate(${+rot.toFixed(1)}deg)` : ''
    // 손잡이는 «손으로 만지기»가 켜졌을 때만 보인다 — 꺼져 있으면 선택 테두리만 남는다
    for (const hd of Array.from(selBox.children) as HTMLElement[]) hd.style.display = handDrag ? 'block' : 'none'
    placeTip(selTip, r, `${Math.round(w)} × ${Math.round(h)}${rot ? ` · ${Math.round(rot)}°` : ''}`)
    selTip.style.top = r.bottom + 4 + 'px'
    selTip.style.left = r.left + r.width / 2 - selTip.offsetWidth / 2 + 'px'
    paintBoxModel(selected)
    paintMulti()
  } else { selBox.style.display = 'none'; paintMulti(); selTip.style.display = 'none'; paintBoxModel(null) }
  paintMeasure(altDown ? selected : null, hovered)
}

/* ---------- React fiber ---------- */
function fiberOf(el: Element): any {
  const k = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  return k ? (el as any)[k] : null
}
const NOISE = /Router|Boundary|Provider|Segment|Template|Root|Loading|Handler|Fallback|Context|Portal|HotReload|DevOverlay|Suspense|Fragment|^Head$|^Body$|^Layout$|Reveal|^Intercept|^Client|Consumer|^Link$|^Image$|^Script$|^LoadableComponent|^Head|^ViewTransition|^Activity/
function nameOfType(t: any): string {
  if (!t) return ''
  if (typeof t === 'function') return t.displayName || t.name || ''
  if (typeof t === 'object') return nameOfType(t.render) || nameOfType(t.type) || ''
  return ''
}
function componentsOf(el: Element): string[] {
  const out: string[] = []
  let f = fiberOf(el)
  let guard = 0
  while (f && guard++ < 400 && out.length < 6) {
    const n = nameOfType(f.type)
    if (n && /^[A-Z]/.test(n) && !NOISE.test(n) && !out.includes(n)) out.push(n)
    f = f.return
  }
  return out
}
function ownerOf(el: Element): string | undefined {
  let f = fiberOf(el)?._debugOwner
  let guard = 0
  while (f && guard++ < 50) {
    const n = nameOfType(f.type)
    if (n && /^[A-Z]/.test(n) && !NOISE.test(n)) return n
    f = f._debugOwner
  }
  return componentsOf(el)[0]
}

/* ---------- 설명 ---------- */
const KEYS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-radius', 'border-width', 'border-color', 'border-style', 'gap', 'display', 'flex-direction', 'justify-content', 'align-items',
  'width', 'height', 'opacity', 'box-shadow', 'position', 'overflow', 'object-fit']

function cssPath(el: Element): string {
  const parts: string[] = []
  let e: Element | null = el
  while (e && e !== document.documentElement && parts.length < 12) {
    let s = e.tagName.toLowerCase()
    if (e.id) { parts.unshift(s + '#' + CSS.escape(e.id)); break }
    const parent: Element | null = e.parentElement
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === e!.tagName)
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(e) + 1})`
    }
    parts.unshift(s)
    e = parent
  }
  return parts.join(' > ')
}

function directText(el: Element): string {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim()
}
function ownText(el: Element): string {
  const t = directText(el) || (el.textContent || '').replace(/\s+/g, ' ').trim()
  return t.slice(0, 160)
}

function describe(el: Element): ElementInfo {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const computed: Record<string, string> = {}
  for (const k of KEYS) computed[k] = cs.getPropertyValue(k)
  const attrs: Record<string, string> = {}
  for (const a of ['href', 'src', 'alt', 'type', 'placeholder', 'aria-label', 'role']) { const v = el.getAttribute(a); if (v) attrs[a] = v.slice(0, 200) }
  const crumbs: ElementInfo['crumbs'] = []
  let p: Element | null = el
  while (p && p !== document.documentElement && crumbs.length < 6) { crumbs.unshift({ hmId: hmId(p), tag: p.tagName.toLowerCase(), label: label(p) }); p = p.parentElement }
  return {
    hmId: hmId(el), tag: el.tagName.toLowerCase(), id: el.id || '', className: (el.getAttribute('class') || '').trim(),
    text: ownText(el), directText: !!directText(el), attrs, rect: { x: r.left, y: r.top, w: r.width, h: r.height }, computed,
    components: componentsOf(el), cssPath: cssPath(el), crumbs,
  }
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'LINK', 'META', 'TEMPLATE', 'NEXTJS-PORTAL'])
function tree(el: Element, depth: number): TreeNode | null {
  if (SKIP_TAGS.has(el.tagName) || el.id === NS) return null
  const node: TreeNode = { hmId: hmId(el), tag: el.tagName.toLowerCase(), label: label(el), component: ownerOf(el), children: [] }
  const t = ownText(el)
  if (t && el.children.length === 0) node.label += `  “${t.slice(0, 24)}${t.length > 24 ? '…' : ''}”`
  if (depth < 14 && el.tagName !== 'svg' && el.tagName !== 'SVG') {
    for (const c of Array.from(el.children)) { const n = tree(c, depth + 1); if (n) node.children.push(n) }
  }
  return node
}

/* ---------- 손으로 옮기고 키우기 (PPT·포토샵의 그 손) ---------- */

/**
 * 🔴 웹은 흐름 레이아웃이라 «픽셀을 박는» 조작이 그대로는 코드가 되지 않는다.
 *    그래서 드래그를 좌표가 아니라 «의미 있는 CSS» 로 번역한다:
 *      이동 = transform: translate  (기본 — 흐름을 안 깨고 겹칠 수 있다. PPT 에 제일 가깝다)
 *           = margin                (「밀기」 모드 — 주변이 실제로 밀려난다)
 *      크기 = width / height
 *      회전 = transform: rotate
 *    셋 다 Tailwind 로 그대로 적힌다(`translate-x-[12px]`·`w-[320px]`·`rotate-[6deg]`).
 *    `position:absolute` 를 박지 않는 게 이 설계의 전부다 — 그 순간 반응형이 죽는다.
 */
type MoveMode = 'translate' | 'margin'
let moveMode: MoveMode = 'translate'
let handDrag = true

interface DragState {
  kind: 'move' | 'resize' | 'rotate'
  handle: string
  el: HTMLElement
  x0: number
  y0: number
  rect: DOMRect
  start: { tx: number; ty: number; rot: number; w: number; h: number; ml: number; mt: number }
  cx: number
  cy: number
  a0: number
  moved: boolean
}
let drag: DragState | null = null
let justDragged = false

function xformOf(el: Element): { tx: number; ty: number; rot: number } {
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return { tx: 0, ty: 0, rot: 0 }
  try {
    const m = new DOMMatrixReadOnly(t)
    return { tx: m.e, ty: m.f, rot: Math.atan2(m.b, m.a) * 180 / Math.PI }
  } catch { return { tx: 0, ty: 0, rot: 0 } }
}

function applyXform(el: HTMLElement, tx: number, ty: number, rot: number): void {
  const parts: string[] = []
  if (tx || ty) parts.push(`translate(${Math.round(tx)}px, ${Math.round(ty)}px)`)
  if (rot) parts.push(`rotate(${+rot.toFixed(1)}deg)`)
  el.style.setProperty('transform', parts.join(' ') || 'none', 'important')
}

function startDrag(e: PointerEvent, kind: DragState['kind'], handle: string): void {
  if (!selected || !handDrag) return
  e.preventDefault(); e.stopPropagation()
  const el = selected as HTMLElement
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const x = xformOf(el)
  drag = {
    kind, handle, el, x0: e.clientX, y0: e.clientY, rect: r,
    start: { tx: x.tx, ty: x.ty, rot: x.rot, w: r.width, h: r.height, ml: px(cs.marginLeft), mt: px(cs.marginTop) },
    cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    a0: Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI,
    moved: false,
  }
  document.body.style.userSelect = 'none'
}

/** 부모·형제의 가장자리에 붙인다 (피그마의 스마트 가이드). Alt 로 끈다. */
function snap(v: number, cands: number[], alt: boolean): { v: number; hit: number | null } {
  if (alt) return { v, hit: null }
  for (const c of cands) if (Math.abs(v - c) <= 4) return { v: c, hit: c }
  return { v: Math.round(v / 8) * 8, hit: null } // 붙을 게 없으면 8px 격자
}

function edgesAround(el: Element): { xs: number[]; ys: number[] } {
  const xs: number[] = [], ys: number[] = []
  const p = el.parentElement
  if (p) {
    const r = p.getBoundingClientRect()
    const cs = getComputedStyle(p)
    xs.push(r.left + px(cs.paddingLeft), r.right - px(cs.paddingRight), r.left + r.width / 2)
    ys.push(r.top + px(cs.paddingTop), r.bottom - px(cs.paddingBottom), r.top + r.height / 2)
    for (const sib of Array.from(p.children)) {
      if (sib === el || SKIP_TAGS.has(sib.tagName)) continue
      const s = sib.getBoundingClientRect()
      if (s.width < 1 && s.height < 1) continue
      xs.push(s.left, s.right, s.left + s.width / 2)
      ys.push(s.top, s.bottom, s.top + s.height / 2)
    }
  }
  return { xs, ys }
}

function paintSnap(lines: { x?: number; y?: number }[]): void {
  snapLayer.innerHTML = ''
  if (!lines.length) { snapLayer.style.display = 'none'; return }
  snapLayer.style.display = 'block'
  for (const l of lines) {
    const d = document.createElement('div')
    d.setAttribute('style', l.x != null
      ? `position:absolute;left:${l.x}px;top:0;width:1px;height:100%;background:#f24822`
      : `position:absolute;left:0;top:${l.y}px;width:100%;height:1px;background:#f24822`)
    snapLayer.appendChild(d)
  }
}

function onDragMove(e: PointerEvent): void {
  if (!drag) return
  e.preventDefault()
  const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0
  if (!drag.moved && Math.hypot(dx, dy) < 3) return
  drag.moved = true
  const { el, start } = drag
  const alt = e.altKey

  if (drag.kind === 'rotate') {
    const a = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx) * 180 / Math.PI
    let rot = start.rot + (a - drag.a0)
    if (e.shiftKey) rot = Math.round(rot / 15) * 15   // Shift = 15도 단위 (PPT 와 같다)
    applyXform(el, start.tx, start.ty, rot)
  } else if (drag.kind === 'move') {
    const { xs, ys } = edgesAround(el)
    const lines: { x?: number; y?: number }[] = []
    const sx = snap(drag.rect.left + dx, xs, alt); const sy = snap(drag.rect.top + dy, ys, alt)
    if (sx.hit != null) lines.push({ x: sx.hit })
    if (sy.hit != null) lines.push({ y: sy.hit })
    paintSnap(lines)
    const mx = sx.v - drag.rect.left, my = sy.v - drag.rect.top
    if (moveMode === 'margin') {
      el.style.setProperty('margin-left', `${Math.round(start.ml + mx)}px`, 'important')
      el.style.setProperty('margin-top', `${Math.round(start.mt + my)}px`, 'important')
    } else {
      applyXform(el, start.tx + mx, start.ty + my, start.rot)
    }
  } else {
    // 크기: 끄는 변만 움직이고 반대쪽은 제자리에 둔다 (PPT 처럼) — 웹은 왼쪽·위가 고정이라 translate 로 보정한다
    const h = drag.handle
    let w = start.w, ht = start.h, tx = start.tx, ty = start.ty
    if (h.includes('e')) w = start.w + dx
    if (h.includes('w')) { w = start.w - dx; tx = start.tx + dx }
    if (h.includes('s')) ht = start.h + dy
    if (h.includes('n')) { ht = start.h - dy; ty = start.ty + dy }
    if (e.shiftKey && h.length === 2) {   // 모서리 + Shift = 비율 유지
      const k = start.h / start.w
      ht = Math.round(w * k)
      if (h.includes('n')) ty = start.ty + (start.h - ht)
    }
    w = Math.max(8, Math.round(w / (alt ? 1 : 8)) * (alt ? 1 : 8))
    ht = Math.max(8, Math.round(ht / (alt ? 1 : 8)) * (alt ? 1 : 8))
    if (h !== 'n' && h !== 's') el.style.setProperty('width', `${w}px`, 'important')
    if (h !== 'e' && h !== 'w') el.style.setProperty('height', `${ht}px`, 'important')
    applyXform(el, tx, ty, start.rot)
  }
  repaint()
}

function endDrag(): void {
  if (!drag) return
  const d = drag
  drag = null
  document.body.style.userSelect = ''
  paintSnap([])
  if (!d.moved) return
  justDragged = true
  setTimeout(() => { justDragged = false }, 0)
  postXform(d.el, d.kind)
}

/** 손으로 만든 결과를 «바꿀 값 목록»으로 호스트에 넘긴다 — 「코드에 적용」이 이걸 먹는다. */
function postXform(el: HTMLElement, kind: DragState['kind']): void {
  const x = xformOf(el)
  const r = el.getBoundingClientRect()
  const changes: { prop: string; value: string }[] = []
  if (kind === 'resize') {
    if (el.style.width) changes.push({ prop: 'width', value: `${Math.round(r.width)}px` })
    if (el.style.height) changes.push({ prop: 'height', value: `${Math.round(r.height)}px` })
  }
  if (kind === 'move' && moveMode === 'margin') {
    const cs = getComputedStyle(el)
    changes.push({ prop: 'margin-left', value: `${Math.round(px(cs.marginLeft))}px` })
    changes.push({ prop: 'margin-top', value: `${Math.round(px(cs.marginTop))}px` })
  }
  if (Math.abs(x.tx) > 0.5 || Math.abs(x.ty) > 0.5 || el.style.transform.includes('translate')) {
    changes.push({ prop: 'translate-x', value: `${Math.round(x.tx)}px` })
    changes.push({ prop: 'translate-y', value: `${Math.round(x.ty)}px` })
  }
  if (Math.abs(x.rot) > 0.05 || el.style.transform.includes('rotate')) {
    changes.push({ prop: 'rotate', value: `${+x.rot.toFixed(1)}deg` })
  }
  post({ type: 'xform', kind, changes, info: describe(el) })
}

/** 방향키로 1px·10px 씩 밀기 (PPT 와 같다). Alt+방향키는 트리 이동으로 남겨 둔다. */
function nudge(dx: number, dy: number): void {
  if (!selected) return
  const el = selected as HTMLElement
  if (moveMode === 'margin') {
    const cs = getComputedStyle(el)
    el.style.setProperty('margin-left', `${Math.round(px(cs.marginLeft) + dx)}px`, 'important')
    el.style.setProperty('margin-top', `${Math.round(px(cs.marginTop) + dy)}px`, 'important')
  } else {
    const x = xformOf(el)
    applyXform(el, x.tx + dx, x.ty + dy, x.rot)
  }
  repaint()
  postXform(el, 'move')
}

/* ---------- 맞추기·나누기·복제 (PPT 의 «정렬» 메뉴) ---------- */

export type AlignHow = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hdist' | 'vdist'

/**
 * 🔴 맞추는 방법이 두 가지다. 여기는 «눈으로 맞추는» 쪽 — 고른 것들을 `translate` 로 밀어 가장자리를 맞춘다.
 *    제대로 된 답은 대개 «부모를 flex 로 바꾸는 것»이고, 그건 Claude 가 한다 (디자인 패널의 「Claude 로」).
 *    그래서 이 버튼은 «지금 눈에 맞추기», 저 버튼은 «구조를 고치기»다. 둘을 같은 것으로 말하지 마라.
 *
 * 기준은 **주 선택**이다 (PPT 와 같다 — 마지막에 고른 것에 나머지를 맞춘다).
 */
/**
 * 🔴 «보이는» 것만 맞춘다. 화면 밖에 숨긴 접근성 링크(`skip-link` 처럼 `-left-[9999px]`)가 섞이면
 *    그걸 끌어오느라 translate 가 10,199px 같은 값이 된다 — 실측으로 밟았다 (2026-09-12).
 */
function isVisible(el: Element): boolean {
  const r = el.getBoundingClientRect()
  if (r.width < 2 || r.height < 2) return false
  if (r.right < -400 || r.left > innerWidth + 400) return false
  const cs = getComputedStyle(el)
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01
}

function alignSelected(how: AlignHow): void {
  const all = allSelected().filter((e) => e.isConnected) as HTMLElement[]
  const els = all.filter(isVisible)
  const hidden = all.length - els.length
  if (els.length < 2) { post({ type: 'multi', kind: 'align', items: [], skipped: hidden, tooFew: true }); return }
  const rects = new Map<HTMLElement, DOMRect>(els.map((e) => [e, e.getBoundingClientRect()]))
  const base = rects.get(els[0])!            // els[0] = 주 선택

  const moveBy = (el: HTMLElement, dx: number, dy: number): void => {
    if (!dx && !dy) return
    const x = xformOf(el)
    applyXform(el, x.tx + dx, x.ty + dy, x.rot)
  }

  if (how === 'hdist' || how === 'vdist') {
    // 균등 배치: 양 끝은 그대로 두고 사이를 고르게 (PPT 의 «가로/세로 간격을 동일하게»)
    if (els.length < 3) return
    const hor = how === 'hdist'
    const sorted = [...els].sort((a, b) => (hor ? rects.get(a)!.left - rects.get(b)!.left : rects.get(a)!.top - rects.get(b)!.top))
    const first = rects.get(sorted[0])!, last = rects.get(sorted[sorted.length - 1])!
    const span = hor ? (last.left + last.width) - first.left : (last.top + last.height) - first.top
    const used = sorted.reduce((n, e) => n + (hor ? rects.get(e)!.width : rects.get(e)!.height), 0)
    const gap = (span - used) / (sorted.length - 1)
    let cur = hor ? first.left : first.top
    for (const e of sorted) {
      const r = rects.get(e)!
      moveBy(e, hor ? cur - r.left : 0, hor ? 0 : cur - r.top)
      cur += (hor ? r.width : r.height) + gap
    }
  } else {
    for (const el of els.slice(1)) {
      const r = rects.get(el)!
      switch (how) {
        case 'left': moveBy(el, base.left - r.left, 0); break
        case 'right': moveBy(el, base.right - r.right, 0); break
        case 'hcenter': moveBy(el, (base.left + base.width / 2) - (r.left + r.width / 2), 0); break
        case 'top': moveBy(el, 0, base.top - r.top); break
        case 'bottom': moveBy(el, 0, base.bottom - r.bottom); break
        case 'vcenter': moveBy(el, 0, (base.top + base.height / 2) - (r.top + r.height / 2)); break
      }
    }
  }
  repaint()
  postMulti('align', hidden)
}

/**
 * 복제 — 화면에서는 «진짜로» 하나 더 생긴다(DOM 복제). 🔴 **코드는 이걸로 안 바뀐다.**
 * 우리의 되찾기는 className 치환이라 JSX 블록을 복사해 넣지 못한다 — 그건 Claude 의 일이다.
 * 그래서 여기서는 «미리보기»만 만들고, 호스트가 그 사실을 사람에게 말한 뒤 Claude 로 넘긴다 (P6 — 못 하는 걸 한 척하지 않는다).
 */
function duplicateSelected(): void {
  const els = allSelected().filter((e) => e.isConnected) as HTMLElement[]
  if (!els.length) return
  const made: Element[] = []
  for (const el of els) {
    const copy = el.cloneNode(true) as HTMLElement
    copy.removeAttribute('id')
    const x = xformOf(el)
    applyXform(copy, x.tx + 16, x.ty + 16, x.rot)
    el.parentElement?.insertBefore(copy, el.nextSibling)
    made.push(copy)
  }
  // 새로 만든 것으로 선택을 옮긴다 (PPT 도 복제하면 사본이 선택된다)
  selected = made[0]
  selectedPath = cssPath(made[0])
  alsoSelected = made.slice(1)
  repaint()
  post({
    type: 'duplicated',
    count: made.length,
    info: describe(made[0]),
    others: alsoSelected.map((e) => describe(e)),
  })
}

/** 여러 요소에 걸친 결과를 한 번에 올린다 — 요소마다 «무엇을 어떻게» 가 따로 필요하다. */
function postMulti(kind: string, skipped = 0): void {
  const items = allSelected().filter((e) => e.isConnected && isVisible(e)).map((el) => {
    const x = xformOf(el as HTMLElement)
    return {
      info: describe(el),
      changes: [
        { prop: 'translate-x', value: `${Math.round(x.tx)}px` },
        { prop: 'translate-y', value: `${Math.round(x.ty)}px` },
      ],
    }
  })
  post({ type: 'multi', kind, items, skipped })
}

/* ---------- 이벤트 ---------- */
const post = (msg: Record<string, unknown>): void => ipcRenderer.sendToHost('hm', msg)

function pick(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y)
  if (!el || el === document.documentElement || el === document.body) return null
  if (el.closest('#' + NS) || el.closest('nextjs-portal')) return null
  return el
}

function select(el: Element | null, source = 'click'): void {
  selected = el
  selectedPath = el ? cssPath(el) : ''
  alsoSelected = []
  repaint()
  post(el ? { type: 'select', info: describe(el), source, others: [] } : { type: 'clear' })
}

/** Shift+클릭 — 이미 골라 둔 것에 더하거나 뺀다. 마지막에 더한 것이 «주 선택»이 된다. */
function selectAdd(el: Element): void {
  if (!selected) return select(el)
  if (el === selected) {                      // 주 선택을 다시 누르면 목록에서 뺀다
    selected = alsoSelected.shift() ?? null
    selectedPath = selected ? cssPath(selected) : ''
  } else if (alsoSelected.includes(el)) {
    alsoSelected = alsoSelected.filter((x) => x !== el)
  } else {
    alsoSelected = [selected, ...alsoSelected.filter((x) => x !== el)]
    selected = el
    selectedPath = cssPath(el)
  }
  repaint()
  post(selected
    ? { type: 'select', info: describe(selected), source: 'shift', others: alsoSelected.map((e) => describe(e)) }
    : { type: 'clear' })
}

function bind(): void {
  document.addEventListener('mousemove', (e) => {
    if (!selectMode) return
    const el = pick(e.clientX, e.clientY)
    if (el !== hovered) { hovered = el; repaint(); if (el) post({ type: 'hover', hmId: hmId(el), label: label(el) }) }
  }, true)
  document.addEventListener('mouseleave', () => { hovered = null; repaint() })
  document.addEventListener('click', (e) => {
    if (!selectMode && !e.ctrlKey && !e.metaKey) return
    e.preventDefault(); e.stopPropagation()
    if (justDragged) return                       // 끌어 놓은 것은 «클릭»이 아니다
    const el = pick(e.clientX, e.clientY)
    if (!el) return select(null)
    if (e.shiftKey) return selectAdd(el)          // PPT 의 Shift+클릭 — 함께 고르기
    // 같은 걸 다시 누르면 부모로 (피그마의 Shift+Enter)
    if (el === selected && el.parentElement && el.parentElement !== document.body) return select(el.parentElement)
    select(el)
  }, true)
  document.addEventListener('mousedown', (e) => { if (selectMode) { e.preventDefault(); e.stopPropagation() } }, true)
  // 선택한 것 «위»를 누르고 끌면 이동 — 손잡이는 각자 자기 리스너가 먼저 잡는다
  document.addEventListener('pointerdown', (e) => {
    if (!selectMode || !handDrag || drag || !selected) return
    const hit = pick(e.clientX, e.clientY)
    if (!hit || !(selected === hit || selected.contains(hit))) return
    startDrag(e, 'move', 'body')
  }, true)
  document.addEventListener('pointermove', onDragMove, true)
  document.addEventListener('pointerup', endDrag, true)
  document.addEventListener('pointercancel', endDrag, true)
  document.addEventListener('dblclick', (e) => { if (selectMode) { e.preventDefault(); e.stopPropagation() } }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') { altDown = true; repaint(); e.preventDefault() }
    if (!selectMode) return
    if (e.key === 'Escape') { select(null); return }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelected(); return }
    if (!selected) return
    // 방향키 = 1px 밀기 (Shift 10px). 트리 이동은 Alt+방향키 — PPT 를 따랐다.
    if (handDrag && !e.altKey && e.key.startsWith('Arrow')) {
      const k = e.shiftKey ? 10 : 1
      const d: Record<string, [number, number]> = { ArrowLeft: [-k, 0], ArrowRight: [k, 0], ArrowUp: [0, -k], ArrowDown: [0, k] }
      const v = d[e.key]
      if (v) { e.preventDefault(); nudge(v[0], v[1]); return }
    }
    if (e.key === 'ArrowUp' && selected.parentElement && selected.parentElement !== document.body) { e.preventDefault(); select(selected.parentElement, 'key') }
    if (e.key === 'ArrowDown' && selected.firstElementChild) { e.preventDefault(); select(selected.firstElementChild, 'key') }
    if (e.key === 'ArrowLeft' && selected.previousElementSibling) { e.preventDefault(); select(selected.previousElementSibling, 'key') }
    if (e.key === 'ArrowRight' && selected.nextElementSibling) { e.preventDefault(); select(selected.nextElementSibling, 'key') }
  }, true)
  document.addEventListener('keyup', (e) => { if (e.key === 'Alt') { altDown = false; repaint() } }, true)
  window.addEventListener('blur', () => { altDown = false; repaint() })
  window.addEventListener('scroll', repaint, true)
  window.addEventListener('resize', repaint)
  // HMR 로 요소가 갈려도 같은 자리를 다시 잡는다
  new MutationObserver(() => {
    if (selected && !selected.isConnected && selectedPath) {
      const again = document.querySelector(selectedPath)
      if (again) { selected = again; repaint(); post({ type: 'select', info: describe(again), source: 'reselect' }) }
      else select(null)
    }
    schedule()
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] })
  let raf = 0
  function schedule(): void { if (!raf) raf = requestAnimationFrame(() => { raf = 0; repaint() }) }

  ipcRenderer.on('hm', (_e, msg: any) => {
    switch (msg.type) {
      case 'mode': selectMode = !!msg.on; if (!selectMode) { hovered = null; repaint() } break
      case 'align': alignSelected(msg.how as AlignHow); break
      case 'duplicate': duplicateSelected(); break
      case 'hand': handDrag = !!msg.on; moveMode = (msg.moveMode as MoveMode) ?? moveMode; repaint(); break
      case 'nudge': nudge(Number(msg.dx) || 0, Number(msg.dy) || 0); break
      case 'select': { const el = elOf(msg.hmId); if (el) { el.scrollIntoView({ block: 'nearest' }); select(el, 'panel') } break }
      case 'selectAdd': { const el = elOf(msg.hmId); if (el) { el.scrollIntoView({ block: 'nearest' }); selectAdd(el) } break }
      case 'clear': select(null); break
      case 'highlight': { hovered = elOf(msg.hmId); repaint(); break }
      case 'style': { const el = elOf(msg.hmId) as HTMLElement | null; if (el) { el.style.setProperty(msg.prop, msg.value, 'important'); repaint() } break }
      case 'unstyle': { const el = elOf(msg.hmId) as HTMLElement | null; if (el) { el.removeAttribute('style'); repaint() } break }
      case 'text': { const el = elOf(msg.hmId); if (el) { const tn = Array.from(el.childNodes).find((n) => n.nodeType === 3 && (n.textContent || '').trim()); if (tn) tn.textContent = msg.text; else el.textContent = msg.text; repaint() } break }
      case 'tree': post({ type: 'tree', tree: tree(document.body, 0) }); break
      case 'describe': { const el = elOf(msg.hmId); if (el) post({ type: 'select', info: describe(el), source: 'refresh' }); break }
      // 낙서의 번호 핀이 «그 자리에 뭐가 있나»를 물을 때. 선택을 바꾸지 않는다 — 읽기만 한다.
      case 'at': { const el = pick(msg.x, msg.y); post({ type: 'at', id: msg.id, info: el ? describe(el) : null }); break }
    }
  })
}

function init(): void {
  mount()
  bind()
  post({ type: 'ready', url: location.href, title: document.title })
}

// React 하이드레이션이 끝난 뒤에 붙인다 — <html> 밑에 낯선 div 가 먼저 있으면 하이드레이션 불일치가 난다.
if (document.readyState === 'complete') setTimeout(init, 300)
else window.addEventListener('load', () => setTimeout(init, 300))
