import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Send, Square, X, RotateCcw, ClipboardPaste, Eye } from 'lucide-react'
import { askClaude, get, set, toast, useStore } from '../store'
import { Btn, IconBtn, fileUrl } from '../ui'

/**
 * Claude 탭. 「선택한 요소」와 「첨부 이미지」가 프롬프트 앞에 맥락으로 붙어 나간다.
 * 이미지는 끌어다 놓기 / 붙여넣기(Ctrl+V) / 파일 고르기 셋 다 된다 — 전부 프로젝트 안 .homepage-maker/refs 로 복사된 뒤 경로로 넘어간다.
 */
export default function ClaudePanel(): React.ReactNode {
  const chat = useStore((s) => s.chat)
  const running = useStore((s) => s.claudeRunning)
  const sel = useStore((s) => s.selection)
  const images = useStore((s) => s.pendingImages)
  const allowBash = useStore((s) => s.allowBash)
  const auth = useStore((s) => s.auth)
  const sessionId = useStore((s) => s.sessionId)
  const project = useStore((s) => s.project)!
  const text = useStore((s) => s.draft)
  const setText = (v: string): void => set({ draft: v })
  const [useSel, setUseSel] = useState(true)
  const [preview, setPreview] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => { listRef.current?.scrollTo(0, listRef.current.scrollHeight) }, [chat.length])

  const send = (): void => {
    if (!text.trim() || running) return
    void askClaude(text, { includeSelection: useSel })
  }
  const addFiles = async (files: File[]): Promise<void> => {
    const imgs = files.filter((f) => /^image\//.test(f.type))
    if (!imgs.length) return
    const paths: string[] = []
    for (const f of imgs) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      paths.push(await window.hm.images.stashBytes(project.dir, bytes, (f.name || 'image.png').replace(/[^\w.-]/g, '_')))
    }
    set((s) => ({ pendingImages: [...s.pendingImages, ...paths] }))
  }
  const pickFiles = async (): Promise<void> => {
    const picked = await window.hm.images.pick()
    if (!picked.length) return
    const paths = await window.hm.images.stash(project.dir, picked)
    set((s) => ({ pendingImages: [...s.pendingImages, ...paths] }))
  }
  const fromClipboard = async (): Promise<void> => {
    try {
      const items = await navigator.clipboard.read()
      const files: File[] = []
      for (const it of items) { const t = it.types.find((t) => t.startsWith('image/')); if (t) files.push(new File([await it.getType(t)], 'clipboard.' + t.split('/')[1], { type: t })) }
      if (!files.length) return toast('클립보드에 그림이 없다', 'err')
      await addFiles(files)
    } catch (e) { toast('클립보드를 못 읽었다: ' + String(e), 'err') }
  }
  const showPreview = async (): Promise<void> => {
    const st = get()
    const route = st.routes.find((r) => r.path === st.route) ?? null
    setPreview(await window.hm.claude.preview({ dir: project.dir, prompt: text || '(여기에 요청)', selection: useSel ? st.selection : null, route, images, allowBash }))
  }

  return (
    <div className="flex flex-col h-full min-h-0" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files)) }}>
      <div ref={listRef} className="flex-1 min-h-0 overflow-auto px-3 py-2 flex flex-col gap-2">
        {chat.length === 0 && (
          <div className="text-muted text-[12px] leading-relaxed">
            요소를 고르고 「이 버튼을 더 크게, 브랜드색으로」처럼 말하면 된다.<br />
            그림을 끌어다 놓거나 붙여넣고 「이 느낌으로」도 된다.<br />
            말로 설명하기 어려우면 <b>낙서(D)</b> — 화면에 동그라미 치고 ①②③ 을 찍으면
            그 자리가 «무엇»인지까지 같이 간다.<br /><br />
            Claude 는 이 리포 폴더 안에서 파일만 고친다. 커밋·push·배포는 Git 탭에서 사람이 누른다.
            {auth.note && <><br /><br /><span className={auth.mode === 'api' ? 'text-warn' : ''}>{auth.note}</span></>}
          </div>
        )}
        {chat.map((m) => (
          <div key={m.id} className={
            m.role === 'user' ? 'self-end max-w-[92%] bg-accent/20 border border-accent/40 rounded-lg px-2.5 py-1.5 text-[12px] whitespace-pre-wrap'
              : m.role === 'assistant' ? 'self-start max-w-[95%] bg-panel-2 border border-line rounded-lg px-2.5 py-1.5 text-[12px] whitespace-pre-wrap leading-relaxed'
                : m.role === 'tool' ? 'self-start text-[10px] text-muted font-mono truncate max-w-full pl-1'
                  : `self-center text-[10px] ${m.error ? 'text-err' : 'text-muted'} text-center whitespace-pre-wrap`
          }>
            {m.role === 'tool' ? <><span className="text-accent">{m.tool?.name}</span> {m.tool?.detail}</> : m.text}
            {m.images?.length ? <div className="mt-1 flex gap-1 flex-wrap">{m.images.map((p) => <img key={p} src={fileUrl(p)} className="h-10 rounded border border-line" />)}</div> : null}
          </div>
        ))}
        {running && <div className="self-start text-[11px] text-muted animate-pulse">Claude 가 일하는 중…</div>}
      </div>

      {preview && (
        <div className="border-t border-line bg-bg p-2 max-h-56 overflow-auto">
          <div className="flex items-center justify-between text-[10px] text-muted mb-1"><span>이렇게 나간다 (프롬프트 미리보기)</span><button type="button" className="cursor-pointer hover:text-fg" onClick={() => setPreview(null)}><X size={12} /></button></div>
          <pre className="text-[10px] font-mono whitespace-pre-wrap text-fg/80">{preview}</pre>
        </div>
      )}

      <div className="border-t border-line p-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
          {sel ? (
            <label className={`inline-flex items-center gap-1 px-1.5 h-6 rounded border cursor-pointer ${useSel ? 'border-accent text-fg' : 'border-line text-muted'}`}>
              <input type="checkbox" checked={useSel} onChange={(e) => setUseSel(e.target.checked)} className="accent-accent" />
              선택: {sel.tag}{sel.components[0] ? ' · ' + sel.components[0] : ''}
            </label>
          ) : <span className="text-muted">선택 없음 — 페이지 전체 요청으로 간다</span>}
          {images.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 h-6 pl-0.5 pr-1 rounded border border-line">
              <img src={fileUrl(p)} className="h-5 w-5 object-cover rounded-sm" />
              <button type="button" className="text-muted hover:text-err cursor-pointer" onClick={() => set((s) => ({ pendingImages: s.pendingImages.filter((x) => x !== p) }))}><X size={11} /></button>
            </span>
          ))}
        </div>
        <textarea ref={taRef} className="w-full min-h-[64px] max-h-40 px-2 py-1.5 text-[12px] resize-y" placeholder="무엇을 어떻게 바꿀까? (Ctrl+Enter 로 보내기 · 그림은 끌어다 놓거나 Ctrl+V)"
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() } }}
          onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); void addFiles(fs) } }} />
        <div className="flex items-center gap-1">
          <IconBtn title="이미지 파일 첨부" onClick={() => void pickFiles()}><ImagePlus size={14} /></IconBtn>
          <IconBtn title="클립보드의 그림 첨부" onClick={() => void fromClipboard()}><ClipboardPaste size={14} /></IconBtn>
          <IconBtn title="프롬프트 미리보기" onClick={() => void showPreview()}><Eye size={14} /></IconBtn>
          <label className="inline-flex items-center gap-1 text-[10px] text-muted ml-1 cursor-pointer" title="켜면 이번 요청부터 Claude 가 셸 명령을 돌릴 수 있다 (npm install 등). 기본은 파일 도구만.">
            <input type="checkbox" className="accent-accent" checked={allowBash} onChange={(e) => { set({ allowBash: e.target.checked }); void window.hm.settings.set({ claude: { allowBash: e.target.checked } }) }} /> Bash
          </label>
          {sessionId && <IconBtn title="새 대화 (맥락 초기화)" onClick={() => set({ sessionId: undefined, chat: [] })}><RotateCcw size={13} /></IconBtn>}
          {/* 🔴 돈이 나가는지 아닌지를 «항상» 보이게 둔다 — 끝난 뒤 금액만 보면 구독도 청구로 읽힌다 */}
          <span className={`text-[10px] ml-1 ${auth.mode === 'api' ? 'text-warn' : 'text-muted'}`} title={auth.note}>
            {auth.mode === 'subscription' ? `구독 ${auth.plan ?? ''}` : auth.mode === 'api' ? 'API 키 · 청구됨' : '인증 ?'}
          </span>
          <div className="flex-1" />
          {running
            ? <Btn kind="danger" onClick={() => { void window.hm.claude.abort(); set({ claudeRunning: false }) }}><Square size={12} /> 중단</Btn>
            : <Btn kind="primary" onClick={send} disabled={!text.trim()}><Send size={12} /> 보내기</Btn>}
        </div>
      </div>
    </div>
  )
}
