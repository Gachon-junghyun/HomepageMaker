import { MapPin, Pen, ArrowUpRight, Square, Circle, Highlighter, Type, Undo2, Trash2, Send, X } from 'lucide-react'
import { set, useStore, type SketchTool } from '../store'
import { sketchToAttachment } from './Sketch'
import { IconBtn } from '../ui'

/** 낙서 도구 팔레트. 캔버스 아래 가운데 떠 있다 (피그마의 도구 막대 자리). */
const TOOLS: { id: SketchTool; icon: React.ReactNode; title: string }[] = [
  { id: 'pin', icon: <MapPin size={15} />, title: '번호 핀 (1) — 찍은 자리의 «요소»까지 Claude 에게 같이 간다' },
  { id: 'pen', icon: <Pen size={15} />, title: '펜 (2)' },
  { id: 'arrow', icon: <ArrowUpRight size={15} />, title: '화살표 (3)' },
  { id: 'rect', icon: <Square size={15} />, title: '사각형 (4)' },
  { id: 'ellipse', icon: <Circle size={15} />, title: '동그라미 (5)' },
  { id: 'highlight', icon: <Highlighter size={15} />, title: '형광펜 (6)' },
  { id: 'text', icon: <Type size={15} />, title: '글 적기 (7)' },
]

const COLORS = ['#f24822', '#ffcc00', '#0d99ff', '#14ae5c', '#000000', '#ffffff']

export default function SketchBar(): React.ReactNode {
  const tool = useStore((s) => s.sketchTool)
  const color = useStore((s) => s.sketchColor)
  const w = useStore((s) => s.sketchWidth)
  const items = useStore((s) => s.sketch)
  const pins = items.filter((i) => i.kind === 'pin').length

  return (
    // 🔴 absolute 로 두면 캔버스가 «스크롤되는» 컨테이너라 툴바가 콘텐츠 바닥으로 딸려간다. fixed + 좌우 패널 폭 보정.
    <div className="fixed bottom-4 left-[calc(260px+(100vw-600px)/2)] -translate-x-1/2 z-30 flex items-center gap-1 rounded-xl bg-panel/95 border border-line shadow-2xl px-2 py-1.5 backdrop-blur">
      {TOOLS.map((t) => (
        <IconBtn key={t.id} title={t.title} active={tool === t.id} onClick={() => set({ sketchTool: t.id })}>{t.icon}</IconBtn>
      ))}
      <div className="w-px h-5 bg-line mx-1" />
      {COLORS.map((c) => (
        <button key={c} type="button" title={c} onClick={() => set({ sketchColor: c })}
          className={`h-5 w-5 rounded-full border cursor-pointer ${color === c ? 'border-white ring-2 ring-accent' : 'border-line'}`}
          style={{ background: c }} />
      ))}
      <input type="range" min={2} max={12} value={w} onChange={(e) => set({ sketchWidth: +e.target.value })} className="w-16 mx-1 accent-accent" title="굵기" />
      <div className="w-px h-5 bg-line mx-1" />
      <IconBtn title="되돌리기 (Ctrl+Z)" disabled={!items.length} onClick={() => set((s) => ({ sketch: s.sketch.slice(0, -1) }))}><Undo2 size={15} /></IconBtn>
      <IconBtn title="전부 지우기" disabled={!items.length} onClick={() => set({ sketch: [] })}><Trash2 size={15} /></IconBtn>
      <button type="button" disabled={!items.length}
        onClick={() => void sketchToAttachment().then(() => set({ sketch: [] }))}
        className="ml-1 inline-flex items-center gap-1 h-7 px-2.5 rounded bg-accent hover:bg-accent-2 text-white text-[12px] font-medium disabled:opacity-40 cursor-pointer">
        <Send size={13} /> Claude 에게{pins ? ` (핀 ${pins})` : ''}
      </button>
      <IconBtn title="낙서 끄기 (D)" onClick={() => set({ sketchOn: false })}><X size={15} /></IconBtn>
    </div>
  )
}
