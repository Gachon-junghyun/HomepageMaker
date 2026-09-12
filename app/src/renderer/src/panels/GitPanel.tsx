import { useEffect, useState } from 'react'
import { GitBranch, Upload, Download, RefreshCw, Undo2 } from 'lucide-react'
import type { GitStatus } from '@shared/types'
import { toast, useStore } from '../store'
import { Btn, Empty, IconBtn, Section } from '../ui'

/**
 * Git 탭 — 피그마의 «버전 히스토리» 자리. 바뀐 파일 / 커밋 / push·pull / 로그.
 * push 는 사람이 누른다. 이 앱에서 «인터넷으로 나가는» 버튼은 이것 하나다 (배포는 리포 쪽 CI 가 push 를 보고 한다).
 */
export default function GitPanel(): React.ReactNode {
  const project = useStore((s) => s.project)!
  const gitTick = useStore((s) => s.gitTick)
  const [st, setSt] = useState<GitStatus | null>(null)
  const [msg, setMsg] = useState('')
  const [remote, setRemote] = useState('')
  const [busy, setBusy] = useState(false)
  const [diffOf, setDiffOf] = useState<{ path: string; text: string } | null>(null)

  const refresh = (): Promise<void> => window.hm.git.status(project.dir).then(setSt).catch((e) => toast(String(e), 'err'))
  useEffect(() => { void refresh() }, [project.dir, gitTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (label: string, fn: () => Promise<string>): Promise<void> => {
    setBusy(true)
    try { const out = await fn(); toast(`${label} 완료${out.trim() ? ' — ' + out.trim().split('\n').slice(-1)[0].slice(0, 80) : ''}`); await refresh() }
    catch (e) { toast(`${label} 실패: ${String(e).slice(0, 200)}`, 'err') }
    finally { setBusy(false) }
  }

  if (!st) return <Empty>읽는 중…</Empty>
  if (!st.isRepo) return (
    <Empty>git 리포가 아니다.<br /><br /><Btn kind="primary" onClick={() => void run('git init', () => window.hm.git.init(project.dir))}>git init</Btn></Empty>
  )
  const ghUrl = st.remote.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '')

  return (
    <div className="flex flex-col min-h-0 h-full">
      <Section title={`브랜치 ${st.branch}`} right={<IconBtn title="새로고침" onClick={() => void refresh()}><RefreshCw size={12} /></IconBtn>}>
        {st.remote ? (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-muted truncate flex-1" title={st.remote}>{st.remote}</span>
            {/github\.com/.test(ghUrl) && <Btn onClick={() => void window.hm.project.openExternal(ghUrl)} title="GitHub 에서 보기"><GitBranch size={12} /></Btn>}
          </div>
        ) : (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (remote.trim()) void run('remote 연결', () => window.hm.git.setRemote(project.dir, remote.trim())) }}>
            <input className="flex-1 h-6 px-1 text-[11px]" placeholder="GitHub 리포 URL 로 연결" value={remote} onChange={(e) => setRemote(e.target.value)} />
            <Btn kind="primary">연결</Btn>
          </form>
        )}
        <div className="flex gap-1">
          <Btn kind="solid" disabled={busy || !st.remote} onClick={() => void run('push', () => window.hm.git.push(project.dir))} title="origin 으로 push — 리포에 CI(Cloudflare 등)가 걸려 있으면 이게 곧 배포다"><Upload size={12} /> push{st.ahead ? ` (${st.ahead})` : ''}</Btn>
          <Btn kind="solid" disabled={busy || !st.remote} onClick={() => void run('pull', () => window.hm.git.pull(project.dir))}><Download size={12} /> pull{st.behind ? ` (${st.behind})` : ''}</Btn>
        </div>
      </Section>

      <Section title={`바뀐 파일 ${st.changes.length}`}>
        {st.changes.length === 0 && <div className="text-muted text-[11px]">깨끗하다.</div>}
        <div className="max-h-40 overflow-auto flex flex-col">
          {st.changes.map((c) => (
            <div key={c.path} className="group flex items-center gap-2 h-6 text-[11px] font-mono cursor-pointer hover:bg-white/5 px-1 rounded"
              onClick={() => void window.hm.git.diff(project.dir, c.path).then((t) => setDiffOf({ path: c.path, text: t || '(새 파일이거나 diff 없음)' }))}>
              <span className={`w-4 text-center ${c.code === '??' ? 'text-ok' : c.code.includes('D') ? 'text-err' : 'text-warn'}`}>{c.code}</span>
              <span className="truncate flex-1">{c.path}</span>
              {c.code !== '??' && <button type="button" title="이 파일 되돌리기" className="opacity-0 group-hover:opacity-100 text-muted hover:text-err cursor-pointer"
                onClick={(e) => { e.stopPropagation(); if (confirm(`${c.path} 의 변경을 버릴까?`)) void run('되돌리기', () => window.hm.git.checkoutFile(project.dir, c.path)) }}><Undo2 size={12} /></button>}
            </div>
          ))}
        </div>
        {st.changes.length > 0 && (
          <form className="flex flex-col gap-1" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) { void run('커밋', () => window.hm.git.commit(project.dir, msg.trim())); setMsg('') } }}>
            <input className="h-7 px-2 text-[12px]" placeholder="커밋 메시지 (무엇을 왜)" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <Btn kind="primary" disabled={busy || !msg.trim()} className="justify-center">전부 담아 커밋</Btn>
          </form>
        )}
      </Section>

      {diffOf && (
        <div className="border-b border-line">
          <div className="flex items-center justify-between px-3 h-7 text-[11px]"><span className="font-mono truncate">{diffOf.path}</span><button type="button" className="text-muted hover:text-fg cursor-pointer" onClick={() => setDiffOf(null)}>닫기</button></div>
          <pre className="max-h-56 overflow-auto px-3 pb-2 text-[10px] font-mono leading-[1.5]">
            {diffOf.text.split('\n').map((l, i) => <div key={i} className={l.startsWith('+') && !l.startsWith('+++') ? 'text-ok' : l.startsWith('-') && !l.startsWith('---') ? 'text-err' : l.startsWith('@@') ? 'text-accent' : 'text-fg/70'}>{l}</div>)}
          </pre>
        </div>
      )}

      <Section title="기록">
        <div className="flex flex-col">
          {st.log.map((l) => (
            <div key={l.hash} className="flex items-baseline gap-2 text-[11px] h-6 hover:bg-white/5 px-1 rounded cursor-default" title={l.hash}>
              <span className="font-mono text-muted">{l.hash}</span>
              <span className="text-muted text-[10px]">{l.date}</span>
              <span className="truncate flex-1">{l.subject}</span>
            </div>
          ))}
        </div>
      </Section>
      <div className="p-3 text-[10px] text-muted leading-relaxed">
        배포는 이 앱이 안 한다. 리포에 걸린 CI(수산나는 Cloudflare Workers Builds)가 push 를 보고 올린다 — 그래서 push 가 곧 발행이다. 확인하고 눌러라.
      </div>
    </div>
  )
}
