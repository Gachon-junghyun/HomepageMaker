import { useEffect } from 'react'
import { onClaudeEvent, set, useStore } from './store'
import Start from './components/Start'
import TopBar from './components/TopBar'
import Canvas from './components/Canvas'
import LogDrawer from './components/LogDrawer'
import LeftPanel from './panels/LeftPanel'
import RightPanel from './panels/RightPanel'

/**
 * 화면 구성 = 피그마 그대로: 위 툴바 / 왼쪽 레이어·페이지 / 가운데 캔버스 / 오른쪽 디자인·코드·Claude·Git.
 * 프로젝트가 없으면 시작 화면.
 */
export default function App(): React.ReactNode {
  const project = useStore((s) => s.project)
  const toast = useStore((s) => s.toast)
  const logOpen = useStore((s) => s.logOpen)
  /** 낙서 툴바가 떠 있으면 토스트를 그 위로 올린다 — 안 그러면 방금 한 일을 알리는 말이 도구를 가린다. */
  const sketchOn = useStore((s) => s.sketchOn)

  useEffect(() => {
    const offLog = window.hm.dev.onLog((s) => set((st) => ({ logs: [...st.logs, s].slice(-800) })))
    const offState = window.hm.dev.onState((d) => set({ dev: d }))
    const offClaude = window.hm.claude.onEvent(onClaudeEvent)
    void window.hm.settings.get().then((s) => set({ allowBash: !!s.claude?.allowBash }))
    void window.hm.claude.auth().then((auth) => set({ auth }))
    return () => { offLog(); offState(); offClaude() }
  }, [])

  return (
    <div className="h-full flex flex-col">
      {project ? (
        <>
          <TopBar />
          <div className="flex-1 min-h-0 flex">
            <LeftPanel />
            <div className="flex-1 min-w-0 flex flex-col">
              <Canvas />
              {logOpen && <LogDrawer />}
            </div>
            <RightPanel />
          </div>
        </>
      ) : (
        <Start />
      )}
      {toast && (
        <div className={`fixed ${sketchOn ? 'bottom-16' : 'bottom-4'} left-1/2 -translate-x-1/2 px-3 py-2 rounded shadow-lg text-[12px] max-w-[70vw] z-50 ${toast.kind === 'err' ? 'bg-err text-white' : 'bg-panel-2 border border-line text-fg'}`}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
