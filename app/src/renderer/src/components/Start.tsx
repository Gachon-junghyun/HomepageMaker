import { useEffect, useState } from 'react'
import { FolderOpen, GitBranch, Plus, X, Trash2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { openProject, set, toast, useStore } from '../store'
import { Btn } from '../ui'

/** 시작 화면 — 최근 프로젝트 / 폴더 열기 / GitHub 에서 가져오기 / 템플릿으로 새로 만들기 */
export default function Start(): React.ReactNode {
  const [recent, setRecent] = useState<Project[]>([])
  const [templates, setTemplates] = useState<string[]>([])
  const [mode, setMode] = useState<'none' | 'clone' | 'new'>('none')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [tpl, setTpl] = useState('')
  const [busy, setBusy] = useState(false)
  const logs = useStore((s) => s.logs)

  useEffect(() => {
    void window.hm.settings.get().then((s) => setRecent(s.recent ?? []))
    void window.hm.project.templates().then((t) => { setTemplates(t); setTpl(t[0] ?? '') })
  }, [])

  const run = async (fn: () => Promise<Project | null>): Promise<void> => {
    setBusy(true); set({ logs: [] })
    try { const p = await fn(); if (p) await openProject(p) } catch (e) { toast(String(e), 'err') } finally { setBusy(false) }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="drag h-9 flex items-center px-4 text-[12px] text-muted select-none">홈페이지 제작소</div>
      <div className="flex-1 flex items-start justify-center pt-16 overflow-auto">
        <div className="w-[760px] grid grid-cols-[1fr_300px] gap-8">
          <div>
            <h1 className="text-[22px] font-semibold mb-1">홈페이지 제작소</h1>
            <p className="text-muted mb-6 leading-relaxed">
              Next.js 홈페이지 리포를 열면 화면이 뜬다. 요소를 클릭해 PPT 처럼 색·글자·간격을 바꾸고,
              그림을 들고 와서 Claude 에게 「이렇게 해줘」 하면 코드가 바뀐다. 마음에 들면 커밋·push.
            </p>
            <div className="flex gap-2 mb-6">
              <Btn kind="primary" disabled={busy} onClick={() => run(() => window.hm.project.pick())}><FolderOpen size={14} /> 폴더 열기</Btn>
              <Btn kind="solid" disabled={busy} onClick={() => setMode(mode === 'clone' ? 'none' : 'clone')}><GitBranch size={14} /> GitHub 에서 가져오기</Btn>
              <Btn kind="solid" disabled={busy || !templates.length} onClick={() => setMode(mode === 'new' ? 'none' : 'new')} title={templates.length ? '' : 'templates/ 폴더가 비어 있다'}><Plus size={14} /> 새 홈페이지</Btn>
            </div>
            {mode === 'clone' && (
              <form className="mb-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void run(() => window.hm.project.clone(url.trim())) }}>
                <input className="flex-1 px-2 h-8" placeholder="https://github.com/사용자/리포.git" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus />
                <Btn kind="primary" disabled={busy || !url.trim()}>가져오기</Btn>
              </form>
            )}
            {mode === 'new' && (
              <form className="mb-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && tpl) void run(() => window.hm.project.create(tpl, name.trim())) }}>
                <select className="h-8 px-2" value={tpl} onChange={(e) => setTpl(e.target.value)}>{templates.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <input className="flex-1 px-2 h-8" placeholder="폴더 이름 (영문·숫자·-)" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <Btn kind="primary" disabled={busy || !name.trim()}>만들기</Btn>
              </form>
            )}
            {busy && (
              <pre className="bg-panel border border-line rounded p-3 text-[11px] text-muted max-h-64 overflow-auto whitespace-pre-wrap font-mono">{logs.join('') || '…'}</pre>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold text-muted mb-2">최근</div>
            {recent.length === 0 && <div className="text-muted text-[12px]">아직 없다.</div>}
            <div className="flex flex-col gap-1">
              {recent.map((p) => (
                <div key={p.dir} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-white/5 cursor-pointer" onClick={() => !busy && run(async () => window.hm.project.open(p.dir))}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium truncate">{p.name}</div>
                    <div className="text-[10px] text-muted truncate" title={p.dir}>{p.dir}</div>
                  </div>
                  <button type="button" className="opacity-0 group-hover:opacity-100 text-muted hover:text-err cursor-pointer" title="목록에서 지우기(폴더는 안 지운다)"
                    onClick={(e) => { e.stopPropagation(); void window.hm.project.forget(p.dir).then(setRecent) }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {mode !== 'none' && <button type="button" className="fixed top-2 right-3 text-muted hover:text-fg cursor-pointer" onClick={() => setMode('none')}><X size={14} /></button>}
    </div>
  )
}
