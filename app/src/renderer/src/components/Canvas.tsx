import { useEffect, useRef } from 'react'
import type { WebviewTag } from 'electron'
import { DEVICES, get, mergeLive, set, setHand, toast, useStore, wv, type SketchTool } from '../store'
import Sketch from './Sketch'
import SketchBar from './SketchBar'

/**
 * 가운데 캔버스. 어두운 바닥 위에 «기기 폭»짜리 webview 가 떠 있고, 줌은 CSS transform 이다 (피그마의 캔버스 줌).
 * webview 안에서 오는 말(ipc-message 'hm')은 전부 여기서 받아 store 에 넣는다.
 */
export default function Canvas(): React.ReactNode {
  const ref = useRef<WebviewTag | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const dev = useStore((s) => s.dev)
  const route = useStore((s) => s.route)
  const device = useStore((s) => s.device)
  const zoom = useStore((s) => s.zoom)
  const project = useStore((s) => s.project)
  const sketchOn = useStore((s) => s.sketchOn)

  // dev 서버 URL 이 처음 잡히면 그 페이지로
  useEffect(() => {
    const w = ref.current
    if (!w || !dev.url) return
    const target = dev.url + route
    if (get().pageUrl !== target) { set({ pageUrl: target }); w.setAttribute('src', target) }
  }, [dev.url]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const w = ref.current
    if (!w) return
    wv.bind(w)
    let treeTimer: ReturnType<typeof setTimeout> | undefined
    const askTree = (): void => { clearTimeout(treeTimer); treeTimer = setTimeout(() => wv.send({ type: 'tree' }), 250) }

    /**
     * 🔴 오버레이(preload)가 안 붙은 채 페이지만 뜨는 일이 있다 — dev 서버가 첫 컴파일 중이라
     * 로드가 한 번 엎어졌을 때다. 그러면 클릭도 핀도 조용히 안 먹는다. 응답이 없으면 한 번 되살린다.
     */
    let readyTimer: ReturnType<typeof setTimeout> | undefined
    let revived = 0
    const expectReady = (): void => {
      clearTimeout(readyTimer)
      readyTimer = setTimeout(() => { if (revived++ < 2) { try { w.reload() } catch { /* */ } } }, 4000)
    }

    const onMsg = (e: Electron.IpcMessageEvent): void => {
      if (e.channel !== 'hm') return
      const m = e.args[0] as any
      switch (m.type) {
        case 'ready':
          clearTimeout(readyTimer)
          revived = 0
          wv.send({ type: 'mode', on: get().selectMode })
          wv.send({ type: 'hand', on: get().hand, moveMode: get().moveMode })
          askTree()
          break
        case 'select':
          if (m.source !== 'refresh') set({ selection: m.info, others: m.others ?? [], live: [], liveText: null, pending: [] })
          else set({ selection: m.info })
          askTree()
          break
        case 'clear': set({ selection: null, others: [], live: [], liveText: null, pending: [] }); break
        case 'hover': set({ hoverId: m.hmId }); break
        case 'tree': set({ tree: m.tree }); break
        case 'at': wv.resolveAt(m.id, m.info); break
        // 손으로 옮기고·키우고·돌린 결과 — 화면엔 이미 먹었고 여기서는 «적용 대기» 목록에만 담는다
        case 'xform': mergeLive(m.changes); set({ selection: m.info }); break
        // 정렬처럼 여러 요소가 한꺼번에 움직인 결과 — 주 선택 몫만 live 로, 나머지는 pending 으로
        case 'multi': {
          if (m.tooFew) { toast('맞출 게 모자라다 — 보이는 요소가 둘은 돼야 한다', 'err'); break }
          const [first, ...rest] = m.items as { info: any; changes: any[] }[]
          if (first) { mergeLive(first.changes); set({ selection: first.info }) }
          set({ pending: rest })
          if (m.skipped) toast(`${m.skipped}개는 화면에 안 보여서 맞추기에서 뺐다`, 'err')
          break
        }
        case 'duplicated':
          set({ selection: m.info, others: m.others ?? [], live: [], pending: [] })
          toast(`화면에 ${m.count}개 복제했다 — 🔴 코드엔 아직 없다. Claude 에게 보내야 파일에 들어간다`)
          set((st) => ({ draft: st.draft.trim() ? st.draft : '방금 화면에서 복제한 것처럼, 이 요소를 하나 더 만들어 바로 뒤에 넣어라. 내용은 그대로 두고 나중에 내가 고치겠다.' }))
          askTree()
          break
      }
    }
    const onNav = (): void => {
      try {
        const u = new URL(w.getURL())
        set({ route: u.pathname, selection: null, live: [], liveText: null, pageUrl: u.origin + u.pathname })
      } catch { /* about:blank */ }
    }
    const onFail = (e: Electron.DidFailLoadEvent): void => {
      // Next 가 아직 컴파일 중이면 연결 거부가 난다 — 잠시 뒤 다시.
      if (e.errorCode === -102 || e.errorCode === -324) setTimeout(() => { try { w.reload() } catch { /* */ } }, 1200)
    }
    w.addEventListener('ipc-message', onMsg)
    w.addEventListener('did-finish-load', expectReady)
    w.addEventListener('did-navigate', onNav)
    w.addEventListener('did-navigate-in-page', onNav)
    w.addEventListener('did-fail-load', onFail)
    return () => {
      clearTimeout(readyTimer)
      w.removeEventListener('ipc-message', onMsg)
      w.removeEventListener('did-finish-load', expectReady)
      w.removeEventListener('did-navigate', onNav)
      w.removeEventListener('did-navigate-in-page', onNav)
      w.removeEventListener('did-fail-load', onFail)
      wv.bind(null)
    }
  }, [project?.dir])

  // 단축키: V 선택도구 · D 낙서 · 1~7 낙서 도구 · Esc 해제 · Ctrl+0 줌 100
  useEffect(() => {
    const TOOLS: SketchTool[] = ['pin', 'pen', 'arrow', 'rect', 'ellipse', 'highlight', 'text']
    const h = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.ctrlKey || e.metaKey) {
        if (e.ctrlKey && e.key === '0') set({ zoom: 1 })
        return
      }
      const sketching = get().sketchOn
      if (e.key === 'd' || e.key === 'D') return toggleSketch()
      if (e.key === 'h' || e.key === 'H') return setHand({ hand: !get().hand })
      if (sketching && /^[1-7]$/.test(e.key)) return set({ sketchTool: TOOLS[+e.key - 1] })
      if (!sketching && (e.key === 'v' || e.key === 'V')) { const on = !get().selectMode; set({ selectMode: on }); wv.send({ type: 'mode', on }) }
      if (e.key === 'Escape' && !sketching) wv.send({ type: 'clear' })
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const width = DEVICES[device].w
  const full = device === 'full'
  return (
    <div ref={wrap} className="flex-1 min-h-0 bg-canvas overflow-auto relative">
      {!dev.url && (
        <div className="absolute inset-0 flex items-center justify-center text-muted text-[13px]">
          {dev.installing ? 'npm install 중… (로그 버튼으로 진행을 볼 수 있다)' : dev.running ? 'dev 서버가 켜지는 중…' : 'dev 서버가 꺼져 있다 — 위의 ▶ 로 켠다'}
        </div>
      )}
      <div className={full ? 'h-full' : 'p-6 min-w-fit'}>
        <div style={full ? { width: '100%', height: '100%' } : { width: width * zoom, height: `calc((100vh - 120px))`, margin: '0 auto' }}>
          <div style={full ? { width: '100%', height: '100%' } : { width, height: `calc((100vh - 120px) / ${zoom})`, transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            className={`relative ${full ? '' : 'shadow-[0_8px_40px_rgba(0,0,0,.5)] rounded-sm overflow-hidden bg-white'}`}>
            <webview ref={ref as never} style={{ width: '100%', height: '100%' }} />
            <Sketch />
          </div>
        </div>
      </div>
      {sketchOn && <SketchBar />}
    </div>
  )
}

/**
 * 낙서를 켜면 선택 도구를 끈다 — 캔버스 위에 판이 덮이므로 어차피 클릭이 안 내려간다.
 * 끄면 원래대로 되돌린다. 두 모드가 같이 켜져 있다고 착각하게 두지 않는다.
 */
export function toggleSketch(): void {
  const on = !get().sketchOn
  set({ sketchOn: on, selectMode: !on })
  wv.send({ type: 'mode', on: !on })
}
