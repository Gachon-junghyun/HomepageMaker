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
  // 선택 상자 모서리 핸들 4개 (피그마의 리사이즈 핸들 모양 — 여기선 표시용)
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const h = document.createElement('div')
    h.setAttribute('style', `position:absolute;width:7px;height:7px;background:#fff;border:1.5px solid #0d99ff;left:${x ? 'calc(100% - 4px)' : '-4px'};top:${y ? 'calc(100% - 4px)' : '-4px'}`)
    selBox.appendChild(h)
  }
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
    place(selBox, r)
    placeTip(selTip, r, `${Math.round(r.width)} × ${Math.round(r.height)}`)
    selTip.style.top = r.bottom + 4 + 'px'
    selTip.style.left = r.left + r.width / 2 - selTip.offsetWidth / 2 + 'px'
    paintBoxModel(selected)
  } else { selBox.style.display = 'none'; selTip.style.display = 'none'; paintBoxModel(null) }
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
  repaint()
  post(el ? { type: 'select', info: describe(el), source } : { type: 'clear' })
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
    const el = pick(e.clientX, e.clientY)
    if (!el) return select(null)
    // 같은 걸 다시 누르면 부모로 (피그마의 Shift+Enter)
    if (el === selected && el.parentElement && el.parentElement !== document.body) return select(el.parentElement)
    select(el)
  }, true)
  document.addEventListener('mousedown', (e) => { if (selectMode) { e.preventDefault(); e.stopPropagation() } }, true)
  document.addEventListener('dblclick', (e) => { if (selectMode) { e.preventDefault(); e.stopPropagation() } }, true)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt') { altDown = true; repaint(); e.preventDefault() }
    if (!selectMode) return
    if (e.key === 'Escape') { select(null); return }
    if (!selected) return
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
      case 'select': { const el = elOf(msg.hmId); if (el) { el.scrollIntoView({ block: 'nearest' }); select(el, 'panel') } break }
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
