import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { SourceMatch } from '@shared/types'
import { useStore } from '../store'
import { Btn, Empty } from '../ui'

/**
 * 코드 탭 — «이 요소가 소스 어디냐». className grep 결과와 그 줄 주변을 보여준다.
 * kind 가 tokens/text 면 «추정»이라고 같이 말한다 — 유일하게 못 찾은 걸 찾은 척하지 않는다.
 */
const KIND_LABEL: Record<string, string> = { exact: '정확히 일치', substring: '부분 일치', tokens: '클래스가 흩어져 있음 (추정)', text: '글로 찾음 (추정)', none: '못 찾음' }

export default function CodePanel(): React.ReactNode {
  const sel = useStore((s) => s.selection)
  const project = useStore((s) => s.project)!
  const gitTick = useStore((s) => s.gitTick)
  const [res, setRes] = useState<{ matches: SourceMatch[]; kind: string } | null>(null)
  const [pick, setPick] = useState<SourceMatch | null>(null)
  const [snip, setSnip] = useState<{ from: number; lines: string[] } | null>(null)

  useEffect(() => {
    setRes(null); setPick(null); setSnip(null)
    if (!sel) return
    let alive = true
    void window.hm.source.locate(project.dir, sel.className, sel.text).then((r) => { if (alive) { setRes(r); if (r.matches.length === 1) setPick(r.matches[0]) } })
    return () => { alive = false }
  }, [sel?.hmId, sel?.className, project.dir, gitTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pick) return setSnip(null)
    void window.hm.source.snippet(project.dir, pick.file, pick.line).then(setSnip)
  }, [pick, project.dir, gitTick])

  if (!sel) return <Empty>요소를 고르면 그게 소스 어느 줄인지 찾아 보여준다.</Empty>
  if (!res) return <Empty>찾는 중…</Empty>
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 py-2 border-b border-line text-[11px]">
        <span className={res.kind === 'exact' ? 'text-ok' : res.kind === 'none' ? 'text-err' : 'text-warn'}>{KIND_LABEL[res.kind]}</span>
        <span className="text-muted"> · {res.matches.length}곳</span>
      </div>
      <div className="max-h-40 overflow-auto border-b border-line">
        {res.matches.slice(0, 30).map((m, i) => (
          <div key={i} className={`px-3 py-1 cursor-pointer text-[11px] ${pick === m ? 'bg-accent/25' : 'hover:bg-white/5'}`} onClick={() => setPick(m)}>
            <div className="font-mono text-fg">{m.file}<span className="text-muted">:{m.line}</span></div>
            <div className="text-muted font-mono truncate">{m.preview}</div>
          </div>
        ))}
        {res.kind === 'none' && <Empty>className 도 글도 소스에서 못 찾았다. 서드파티 컴포넌트거나 런타임에 만들어진 요소다 — Claude 탭에서 컴포넌트 이름으로 시켜라.</Empty>}
      </div>
      {pick && snip && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-3 h-8 text-[11px] border-b border-line">
            <span className="font-mono truncate">{pick.file}</span>
            <Btn onClick={() => void window.hm.project.openEditor(project.dir + '\\' + pick.file.replace(/\//g, '\\'), pick.line)} title="VS Code 로 열기"><ExternalLink size={12} /> 열기</Btn>
          </div>
          <pre className="flex-1 overflow-auto text-[10.5px] font-mono leading-[1.5] px-2 py-1">
            {snip.lines.map((l, i) => {
              const n = snip.from + i
              return <div key={n} className={n === pick.line ? 'bg-accent/20 -mx-2 px-2' : ''}><span className="text-muted inline-block w-8 text-right mr-2 select-none">{n}</span>{l}</div>
            })}
          </pre>
        </div>
      )}
    </div>
  )
}
