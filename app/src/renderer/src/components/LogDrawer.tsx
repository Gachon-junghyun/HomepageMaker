import { useEffect, useRef } from 'react'
import { set, useStore } from '../store'

/** 아래 서랍 — dev 서버 stdout/stderr. 실패를 조용히 삼키지 않으려고 있다. */
export default function LogDrawer(): React.ReactNode {
  const logs = useStore((s) => s.logs)
  const ref = useRef<HTMLPreElement | null>(null)
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight) }, [logs])
  return (
    <div className="h-48 shrink-0 border-t border-line bg-bg flex flex-col">
      <div className="flex items-center justify-between px-3 h-7 text-[11px] text-muted border-b border-line">
        <span>dev 서버 로그</span>
        <button type="button" className="hover:text-fg cursor-pointer" onClick={() => set({ logs: [] })}>비우기</button>
      </div>
      <pre ref={ref} className="flex-1 overflow-auto px-3 py-2 text-[11px] font-mono whitespace-pre-wrap text-fg/80">{logs.join('')}</pre>
    </div>
  )
}
