import { ChevronLeft, MousePointer2, RefreshCw, ExternalLink, Code2, Terminal, Smartphone, Tablet, Monitor, Maximize2, Minus, Plus, Play, Square, Pencil, Hand } from 'lucide-react'
import { DEVICES, closeProject, set, setHand, useStore, wv, type Device } from '../store'
import { toggleSketch } from './Canvas'
import { IconBtn } from '../ui'

/** 위 툴바. 왼쪽 = 프로젝트·페이지, 가운데 = 도구(선택)·기기·줌, 오른쪽 = dev 서버·열기. */
export default function TopBar(): React.ReactNode {
  const project = useStore((s) => s.project)!
  const routes = useStore((s) => s.routes)
  const route = useStore((s) => s.route)
  const dev = useStore((s) => s.dev)
  const device = useStore((s) => s.device)
  const zoom = useStore((s) => s.zoom)
  const selectMode = useStore((s) => s.selectMode)
  const sketchOn = useStore((s) => s.sketchOn)
  const hand = useStore((s) => s.hand)
  const logOpen = useStore((s) => s.logOpen)

  const setMode = (on: boolean): void => { set({ selectMode: on }); wv.send({ type: 'mode', on }) }
  const go = (path: string): void => { set({ route: path, selection: null, live: [], liveText: null }); if (dev.url) wv.go(dev.url + path) }
  const devIcons: Record<Device, React.ReactNode> = { mobile: <Smartphone size={14} />, tablet: <Tablet size={14} />, desktop: <Monitor size={14} />, full: <Maximize2 size={14} /> }

  return (
    <div className="drag h-9 shrink-0 flex items-center border-b border-line bg-bg px-2 gap-1 select-none">
      <IconBtn title="시작 화면으로 (dev 서버를 끈다)" onClick={() => void closeProject()}><ChevronLeft size={16} /></IconBtn>
      <div className="font-medium text-[12px] px-1 max-w-[180px] truncate" title={project.dir}>{project.name}</div>
      <select className="no-drag h-6 px-1 text-[11px] max-w-[200px]" value={route} onChange={(e) => go(e.target.value)}>
        {!routes.some((r) => r.path === route) && <option value={route}>{route}</option>}
        {routes.map((r) => <option key={r.path} value={r.path}>{r.path}</option>)}
      </select>

      <div className="flex-1" />
      <IconBtn title="선택 도구 (V) — 켜면 클릭이 페이지로 안 가고 요소를 고른다. 꺼도 Ctrl+클릭은 고른다" active={selectMode && !sketchOn} onClick={() => { if (sketchOn) toggleSketch(); else setMode(!selectMode) }}><MousePointer2 size={14} /></IconBtn>
      <IconBtn title="손으로 옮기고 키우기 (H) — 고른 요소에 손잡이가 붙는다. 끌면 이동, 모서리는 크기, 위 동그라미는 회전" active={hand && !sketchOn} onClick={() => setHand({ hand: !hand })}><Hand size={14} /></IconBtn>
      <IconBtn title="낙서 (D) — 화면에 손으로 그리고 번호 핀을 찍어 Claude 에게 설명한다" active={sketchOn} onClick={toggleSketch}><Pencil size={14} /></IconBtn>
      <div className="w-px h-5 bg-line mx-1" />
      {(Object.keys(DEVICES) as Device[]).map((d) => (
        <IconBtn key={d} title={DEVICES[d].label} active={device === d} onClick={() => set({ device: d })}>{devIcons[d]}</IconBtn>
      ))}
      <div className="w-px h-5 bg-line mx-1" />
      <IconBtn title="축소" onClick={() => set({ zoom: Math.max(0.25, +(zoom - 0.1).toFixed(2)) })}><Minus size={14} /></IconBtn>
      <button type="button" className="no-drag text-[11px] w-11 text-center hover:bg-white/10 rounded h-7 cursor-pointer" title="100% 로" onClick={() => set({ zoom: 1 })}>{Math.round(zoom * 100)}%</button>
      <IconBtn title="확대" onClick={() => set({ zoom: Math.min(2, +(zoom + 0.1).toFixed(2)) })}><Plus size={14} /></IconBtn>
      <div className="flex-1" />

      <div className="flex items-center gap-1.5 text-[11px] text-muted px-1" title={dev.url ?? ''}>
        <span className={`inline-block w-2 h-2 rounded-full ${dev.installing ? 'bg-warn animate-pulse' : dev.url ? 'bg-ok' : dev.running ? 'bg-warn animate-pulse' : 'bg-err'}`} />
        {dev.installing ? 'npm install…' : dev.url ? dev.url.replace('http://', '') : dev.running ? '켜는 중…' : '꺼짐'}
      </div>
      {dev.running
        ? <IconBtn title="dev 서버 끄기" onClick={() => void window.hm.dev.stop()}><Square size={13} /></IconBtn>
        : <IconBtn title="dev 서버 켜기" onClick={() => void window.hm.dev.start(project.dir)}><Play size={13} /></IconBtn>}
      <IconBtn title="새로고침" onClick={() => wv.reload()}><RefreshCw size={14} /></IconBtn>
      <IconBtn title="브라우저에서 열기" disabled={!dev.url} onClick={() => void window.hm.project.openExternal(dev.url! + route)}><ExternalLink size={14} /></IconBtn>
      <IconBtn title="VS Code 로 열기" onClick={() => void window.hm.project.openEditor(project.dir)}><Code2 size={14} /></IconBtn>
      <IconBtn title="dev 서버 로그" active={logOpen} onClick={() => set({ logOpen: !logOpen })}><Terminal size={14} /></IconBtn>
      <div className="w-[140px]" />{/* 창 조작 버튼(최소화·닫기) 자리 */}
    </div>
  )
}
