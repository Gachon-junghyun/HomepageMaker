import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FilePlus2 } from 'lucide-react'
import type { ThemeToken, TreeNode } from '@shared/types'
import { askClaude, set, toast, useStore, wv } from '../store'
import { Btn, Empty, Tabs, toHex } from '../ui'

export default function LeftPanel(): React.ReactNode {
  const tab = useStore((s) => s.leftTab)
  return (
    <div className="w-[260px] shrink-0 border-r border-line bg-panel flex flex-col min-h-0">
      <Tabs tabs={[{ id: 'layers', label: '레이어' }, { id: 'pages', label: '페이지' }, { id: 'tokens', label: '토큰' }]} value={tab} onChange={(t) => set({ leftTab: t })} />
      <div className="flex-1 min-h-0 overflow-auto">
        {tab === 'layers' && <Layers />}
        {tab === 'pages' && <Pages />}
        {tab === 'tokens' && <Tokens />}
      </div>
    </div>
  )
}

/* ---------- 레이어: DOM 트리 + React 컴포넌트 이름 (피그마의 레이어 패널) ---------- */
function Layers(): React.ReactNode {
  const tree = useStore((s) => s.tree)
  const sel = useStore((s) => s.selection)
  const others = useStore((s) => s.others)
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  // 선택되면 그 경로를 펼친다
  useEffect(() => {
    if (!sel) return
    setOpen((o) => { const n = new Set(o); sel.crumbs.forEach((c) => n.add(c.hmId)); return n })
  }, [sel?.hmId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!tree) return <Empty>페이지가 뜨면 트리가 나온다.</Empty>
  const toggle = (id: string): void => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const Node = ({ n, depth }: { n: TreeNode; depth: number }): React.ReactNode => {
    const isOpen = open.has(n.hmId) || depth < 2
    const has = n.children.length > 0
    const active = sel?.hmId === n.hmId
    const also = others.some((o) => o.hmId === n.hmId)
    return (
      <div>
        <div className={`flex items-center h-6 pr-2 cursor-pointer text-[11px] whitespace-nowrap ${active ? 'bg-accent/25 text-white' : also ? 'bg-accent/10' : 'hover:bg-white/5'}`}
          style={{ paddingLeft: depth * 12 + 4 }}
          onMouseEnter={() => wv.send({ type: 'highlight', hmId: n.hmId })}
          onMouseLeave={() => wv.send({ type: 'highlight', hmId: '' })}
          onClick={(e) => wv.send({ type: e.shiftKey ? 'selectAdd' : 'select', hmId: n.hmId })}
          title="Shift+클릭 = 함께 고르기">
          <span className="w-4 shrink-0 text-muted inline-flex items-center justify-center" onClick={(e) => { e.stopPropagation(); if (has) toggle(n.hmId) }}>
            {has ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
          </span>
          {n.component && <span className="text-accent mr-1.5 font-medium">{n.component}</span>}
          <span className="text-fg/90 truncate">{n.label}</span>
        </div>
        {has && isOpen && n.children.map((c) => <Node key={c.hmId} n={c} depth={depth + 1} />)}
      </div>
    )
  }
  return <div className="py-1">{tree.children.map((c) => <Node key={c.hmId} n={c} depth={0} />)}</div>
}

/* ---------- 페이지: app 폴더의 page.tsx 들 (피그마의 «페이지» 목록) ---------- */
function Pages(): React.ReactNode {
  const routes = useStore((s) => s.routes)
  const route = useStore((s) => s.route)
  const dev = useStore((s) => s.dev)
  const project = useStore((s) => s.project)!
  const [adding, setAdding] = useState(false)
  const [path, setPath] = useState('')
  return (
    <div className="py-1">
      {routes.map((r) => (
        <div key={r.path} className={`flex items-center justify-between h-7 px-3 cursor-pointer text-[12px] ${route === r.path ? 'bg-accent/25 text-white' : 'hover:bg-white/5'}`}
          onClick={() => { set({ route: r.path, selection: null, live: [] }); if (dev.url) wv.go(dev.url + r.path) }}>
          <span className="font-medium">{r.path}</span>
          <span className="text-muted text-[10px] truncate ml-2" title={r.file}>{r.file.replace(/^(src\/)?app\//, '')}</span>
        </div>
      ))}
      {routes.length === 0 && <Empty>app/**/page.tsx 가 없다.</Empty>}
      <div className="px-3 pt-2">
        {!adding ? (
          <Btn kind="solid" onClick={() => setAdding(true)}><FilePlus2 size={13} /> 페이지 추가 (Claude)</Btn>
        ) : (
          <form className="flex flex-col gap-1.5" onSubmit={(e) => {
            e.preventDefault()
            const p = '/' + path.trim().replace(/^\/+/, '')
            if (p === '/') return
            setAdding(false); setPath('')
            void askClaude(`새 페이지 ${p} 를 만들어라. 기존 페이지(예: ${routes[0]?.file ?? 'app/page.tsx'})와 같은 레이아웃·헤더·푸터·스타일 규약을 따르고, 제목과 한 문단 자리만 잡아라. 메뉴(내비게이션)에 넣을지는 묻지 말고 넣지 마라 — 사람이 정한다.`, { includeSelection: false })
              .then(() => window.hm.project.routes(project.dir).then((rs) => set({ routes: rs })))
          }}>
            <input className="h-7 px-2" placeholder="/새경로  (예: /events)" value={path} onChange={(e) => setPath(e.target.value)} autoFocus />
            <div className="flex gap-1"><Btn kind="primary">Claude 에게 시키기</Btn><Btn onClick={() => setAdding(false)}>취소</Btn></div>
          </form>
        )}
      </div>
    </div>
  )
}

/* ---------- 토큰: globals.css @theme (피그마의 «로컬 변수/스타일») ---------- */
function Tokens(): React.ReactNode {
  const project = useStore((s) => s.project)!
  const gitTick = useStore((s) => s.gitTick)
  const [file, setFile] = useState<string | null>(null)
  const [tokens, setTokens] = useState<ThemeToken[]>([])
  useEffect(() => { void window.hm.tokens.read(project.dir).then((r) => { setFile(r.file); setTokens(r.tokens) }) }, [project.dir, gitTick])
  const groups = useMemo(() => {
    const g: Record<string, ThemeToken[]> = {}
    for (const t of tokens) { const k = t.name.replace(/^--/, '').split('-')[0] || '기타'; (g[k] ??= []).push(t) }
    return g
  }, [tokens])
  const write = async (t: ThemeToken, v: string): Promise<void> => {
    try { setTokens(await window.hm.tokens.write(project.dir, t.name, v)) } catch (e) { toast(String(e), 'err') }
  }
  if (!file) return <Empty>globals.css 의 @theme 블록이 없다. Tailwind 4 리포가 아니거나 자리가 다르다.</Empty>
  return (
    <div className="py-1">
      <div className="px-3 py-1 text-[10px] text-muted truncate" title={file}>{file} · 바꾸면 바로 저장되고 화면이 따라온다</div>
      {Object.entries(groups).map(([g, list]) => (
        <div key={g} className="border-b border-line pb-1 mb-1">
          <div className="px-3 pt-2 pb-1 text-[11px] font-semibold text-fg">{g}</div>
          {list.map((t) => {
            const isColor = /^#|^rgb|^hsl|^oklch/.test(t.value)
            const hex = isColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t.value) ? t.value : null
            return (
              <div key={t.name} className="flex items-center gap-2 px-3 h-7 text-[11px]">
                {hex ? <input type="color" value={hex.length === 4 ? '#' + hex.slice(1).split('').map((c) => c + c).join('') : hex} onChange={(e) => void write(t, e.target.value)} />
                  : <span className="w-[22px] h-[22px] rounded border border-line inline-block" style={{ background: isColor ? t.value : 'transparent' }} />}
                <span className="text-muted flex-1 truncate" title={t.name}>{t.name.replace(/^--/, '')}</span>
                <input className="w-[92px] h-6 px-1 text-[10px] font-mono" defaultValue={t.value} key={t.value}
                  onBlur={(e) => { if (e.target.value !== t.value) void write(t, e.target.value) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export { toHex }
