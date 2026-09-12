import { useCallback, useEffect, useRef, useState } from 'react'
import type { Pin, SketchItem, Stroke } from '@shared/types'
import { get, set, toast, useStore, wv, type SketchTool } from '../store'

/**
 * 낙서 레이어 — 화면 위에 «손으로 설명하는» 판. webview 위에 겹친 <canvas> 하나다.
 *
 * 🔴 왜 그냥 그림판이 아닌가: **번호 핀**이 이 기능의 본체다.
 *    ①을 찍는 순간 webview 에게 «그 자리에 뭐가 있나»를 물어 요소(태그·class·컴포넌트)를 같이 붙잡아 둔다.
 *    그래서 Claude 는 「빨간 동그라미 친 그거」를 그림에서 다시 추측하지 않는다 — 프롬프트에 「① = <a class="..."> (Header)」로 적혀 나간다.
 *    그림만 주면 그 추측이 조용히 틀린다.
 *
 * 좌표계는 «기기 폭 기준 CSS 픽셀»이다. 줌은 부모의 transform 이 하므로 여기서는 신경 쓰지 않되,
 * 마우스 좌표만 rect 비율로 되돌린다.
 */

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
const circled = (n: number): string => (n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`)

const isPin = (i: SketchItem): i is Pin => i.kind === 'pin'

/** 낙서 하나를 그린다. 화면에 그릴 때와 그림으로 구울 때가 같은 함수를 쓴다 — 보이는 것과 보내는 것이 어긋나지 않게. */
export function paint(ctx: CanvasRenderingContext2D, items: SketchItem[], scale: number): void {
  ctx.save()
  ctx.scale(scale, scale)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const it of items) {
    if (it.kind === 'pin') { paintPin(ctx, it); continue }
    const p = it.points
    if (!p.length) continue
    ctx.strokeStyle = it.color
    ctx.fillStyle = it.color
    ctx.lineWidth = it.width
    ctx.globalAlpha = it.tool === 'highlight' ? 0.35 : 1
    const a = p[0], b = p[p.length - 1]
    switch (it.tool) {
      case 'pen':
      case 'highlight':
        ctx.beginPath()
        ctx.moveTo(p[0].x, p[0].y)
        for (const q of p.slice(1)) ctx.lineTo(q.x, q.y)
        ctx.stroke()
        break
      case 'rect':
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
        break
      case 'ellipse':
        ctx.beginPath()
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2)
        ctx.stroke()
        break
      case 'arrow': {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
        const ang = Math.atan2(b.y - a.y, b.x - a.x)
        const h = Math.max(10, it.width * 3.2)
        ctx.beginPath()
        ctx.moveTo(b.x, b.y)
        ctx.lineTo(b.x - h * Math.cos(ang - 0.42), b.y - h * Math.sin(ang - 0.42))
        ctx.lineTo(b.x - h * Math.cos(ang + 0.42), b.y - h * Math.sin(ang + 0.42))
        ctx.closePath(); ctx.fill()
        break
      }
      case 'text': {
        const size = Math.max(13, it.width * 4)
        ctx.font = `600 ${size}px "Segoe UI","Malgun Gothic",sans-serif`
        const text = it.text ?? ''
        const w = ctx.measureText(text).width
        ctx.globalAlpha = 0.9
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(a.x - 4, a.y - size, w + 8, size + 8)
        ctx.globalAlpha = 1
        ctx.fillStyle = it.color
        ctx.fillText(text, a.x, a.y)
        break
      }
    }
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

function paintPin(ctx: CanvasRenderingContext2D, p: Pin): void {
  const r = 13
  ctx.globalAlpha = 1
  ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fillStyle = '#f24822'; ctx.fill()
  ctx.lineWidth = 2.5; ctx.strokeStyle = '#ffffff'; ctx.stroke()
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 14px "Segoe UI",sans-serif'
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(String(p.n), p.x, p.y + 0.5)
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic'
  if (p.note) {
    ctx.font = '600 13px "Segoe UI","Malgun Gothic",sans-serif'
    const w = ctx.measureText(p.note).width
    ctx.fillStyle = 'rgba(242,72,34,.95)'
    ctx.fillRect(p.x + r + 4, p.y - 11, w + 10, 22)
    ctx.fillStyle = '#fff'
    ctx.fillText(p.note, p.x + r + 9, p.y + 4)
  }
}

export default function Sketch(): React.ReactNode {
  const on = useStore((s) => s.sketchOn)
  const tool = useStore((s) => s.sketchTool)
  const color = useStore((s) => s.sketchColor)
  const width = useStore((s) => s.sketchWidth)
  const items = useStore((s) => s.sketch)
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef<Stroke | null>(null)
  /** 핀 메모·텍스트를 받는 작은 입력칸. 좌표는 논리 px */
  const [entry, setEntry] = useState<{ x: number; y: number; kind: 'pin' | 'text'; value: string; pin?: Pin } | null>(null)

  const size = useCallback((): { w: number; h: number } => {
    const c = ref.current!
    return { w: c.clientWidth, h: c.clientHeight }
  }, [])

  const redraw = useCallback((): void => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const { w, h } = size()
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    const live = drawing.current ? [...items, drawing.current] : items
    paint(ctx, live, dpr)
  }, [items, size])

  useEffect(redraw, [redraw, on])
  useEffect(() => {
    const ro = new ResizeObserver(redraw)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [redraw])

  // 되돌리기 / 전체 지우기
  useEffect(() => {
    if (!on) return
    const h = (e: KeyboardEvent): void => {
      const t = (e.target as HTMLElement)?.tagName
      if (t === 'INPUT' || t === 'TEXTAREA') return
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); set((s) => ({ sketch: s.sketch.slice(0, -1) })) }
      if (e.key === 'Escape') setEntry(null)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [on])

  if (!on) return null

  const at = (e: React.PointerEvent): { x: number; y: number } => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    const k = c.clientWidth / r.width // 줌 되돌리기
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }
  }

  const down = (e: React.PointerEvent): void => {
    if (entry) return
    const p = at(e)
    if (tool === 'pin') return void addPin(p)
    if (tool === 'text') return setEntry({ x: p.x, y: p.y, kind: 'text', value: '' })
    drawing.current = { kind: 'stroke', tool, color, width: tool === 'highlight' ? width * 4 : width, points: [p] }
    try { (e.target as HTMLElement).setPointerCapture(e.pointerId) } catch { /* 합성 포인터엔 캡처가 없다 */ }
    redraw()
  }
  const move = (e: React.PointerEvent): void => {
    const d = drawing.current
    if (!d) return
    const p = at(e)
    if (d.tool === 'pen' || d.tool === 'highlight') d.points.push(p)
    else d.points[1] = p
    redraw()
  }
  const up = (): void => {
    const d = drawing.current
    drawing.current = null
    if (!d) return
    const moved = d.points.length > 1 && (d.tool === 'pen' || d.tool === 'highlight' || Math.hypot(d.points[1].x - d.points[0].x, d.points[1].y - d.points[0].y) > 6)
    if (moved) set((s) => ({ sketch: [...s.sketch, d] }))
    redraw()
  }

  /** 핀 = 찍고 → webview 에 «거기 뭐 있나» 묻고 → 메모칸을 띄운다 */
  const addPin = async (p: { x: number; y: number }): Promise<void> => {
    const n = get().sketch.filter(isPin).length + 1
    const pin: Pin = { kind: 'pin', n, x: p.x, y: p.y, note: '' }
    set((s) => ({ sketch: [...s.sketch, pin] }))
    setEntry({ x: p.x, y: p.y, kind: 'pin', value: '', pin })
    const info = await wv.at(p.x, p.y)
    if (info) {
      pin.target = { tag: info.tag, className: info.className, text: info.text.slice(0, 80), components: info.components }
      set((s) => ({ sketch: [...s.sketch] }))
    }
  }

  const commitEntry = (): void => {
    if (!entry) return
    const v = entry.value.trim()
    if (entry.kind === 'pin') {
      if (entry.pin) { entry.pin.note = v; set((s) => ({ sketch: [...s.sketch] })) }
    } else if (v) {
      set((s) => ({ sketch: [...s.sketch, { kind: 'stroke', tool: 'text', color, width, points: [{ x: entry.x, y: entry.y }], text: v }] }))
    }
    setEntry(null)
  }

  const c = ref.current
  const k = c ? c.getBoundingClientRect().width / (c.clientWidth || 1) : 1 // 입력칸을 화면 배율에 맞춰 놓기

  return (
    <>
      <canvas
        ref={ref}
        className="absolute inset-0 z-10"
        style={{ width: '100%', height: '100%', cursor: tool === 'pin' ? 'copy' : tool === 'text' ? 'text' : 'crosshair' }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
      />
      {entry && (
        <input
          autoFocus
          className="absolute z-20 h-7 px-2 text-[12px] shadow-lg"
          style={{ left: entry.x * k + (entry.kind === 'pin' ? 22 : 0), top: entry.y * k - (entry.kind === 'pin' ? 14 : 26), width: 180 }}
          placeholder={entry.kind === 'pin' ? `${circled(entry.pin?.n ?? 1)} 에 대해 한 마디 (없으면 Enter)` : '화면에 적을 글'}
          value={entry.value}
          onChange={(ev) => setEntry({ ...entry, value: ev.target.value })}
          onKeyDown={(ev) => { if (ev.key === 'Enter') commitEntry(); if (ev.key === 'Escape') setEntry(null) }}
          onBlur={commitEntry}
        />
      )}
    </>
  )
}

/* ---------- 툴바에서 부르는 것들 ---------- */

export const SKETCH_TOOLS: { id: SketchTool; label: string; hint: string }[] = [
  { id: 'pin', label: '핀', hint: '번호 핀 — 찍은 자리의 «요소»까지 Claude 에게 같이 간다 (이게 핵심)' },
  { id: 'pen', label: '펜', hint: '자유선' },
  { id: 'arrow', label: '화살표', hint: '가리키기' },
  { id: 'rect', label: '사각형', hint: '영역 표시' },
  { id: 'ellipse', label: '동그라미', hint: '동그라미 치기' },
  { id: 'highlight', label: '형광펜', hint: '굵고 반투명' },
  { id: 'text', label: '글', hint: '화면에 글 적기' },
]

/**
 * 화면 + 낙서를 한 장의 PNG 로 구워 첨부에 넣는다.
 * 🔴 굽는 건 «보이는 그대로»다 — 화면 캡처 위에 같은 paint() 를 다시 돌린다.
 */
export async function sketchToAttachment(): Promise<void> {
  const s = get()
  if (!s.project) return
  const items = s.sketch
  const dataUrl = await wv.capture()
  if (!dataUrl) return toast('화면을 못 찍었다 — 페이지가 떠 있는지 보라', 'err')

  const img = new Image()
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl })

  const canvasEl = document.querySelector('webview') as HTMLElement | null
  const logicalW = canvasEl?.clientWidth || img.width
  const out = document.createElement('canvas')
  out.width = img.width; out.height = img.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(img, 0, 0)
  paint(ctx, items, img.width / logicalW)

  const blob = await new Promise<Blob | null>((res) => out.toBlob(res, 'image/png'))
  if (!blob) return toast('그림을 못 만들었다', 'err')
  const path = await window.hm.images.stashBytes(s.project.dir, new Uint8Array(await blob.arrayBuffer()), 'sketch.png')

  // 핀에 적은 말이 곧 요청문의 초안이다 — 같은 말을 두 번 치게 하지 않는다. 이미 쓰던 글이 있으면 안 건드린다.
  const notes = items.filter(isPin).filter((p) => p.note).map((p) => `${circled(p.n)} ${p.note}`)
  set((st) => ({
    pendingImages: [...st.pendingImages, path],
    pins: [...st.pins, ...items.filter(isPin)],
    draft: st.draft.trim() ? st.draft : notes.join('\n'),
    rightTab: 'claude',
  }))
  toast(`화면 + 낙서를 첨부했다${items.filter(isPin).length ? ` (핀 ${items.filter(isPin).length}개 설명까지)` : ''}`)
}

/** 자가 검증용 훅 (autotest 가 executeJavaScript 로 만진다). 제품 기능이 아니다. */
;(window as any).__hmSketch = { sketchToAttachment }
