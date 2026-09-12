import { set, useStore } from '../store'
import { Tabs } from '../ui'
import Design from './Design'
import ClaudePanel from './ClaudePanel'
import CodePanel from './CodePanel'
import GitPanel from './GitPanel'

export default function RightPanel(): React.ReactNode {
  const tab = useStore((s) => s.rightTab)
  const running = useStore((s) => s.claudeRunning)
  return (
    <div className="w-[340px] shrink-0 border-l border-line bg-panel flex flex-col min-h-0">
      <Tabs
        tabs={[{ id: 'design', label: '디자인' }, { id: 'claude', label: running ? 'Claude ●' : 'Claude' }, { id: 'code', label: '코드' }, { id: 'git', label: 'Git' }]}
        value={tab} onChange={(t) => set({ rightTab: t })} />
      <div className="flex-1 min-h-0 overflow-auto flex flex-col">
        {tab === 'design' && <Design />}
        {tab === 'claude' && <ClaudePanel />}
        {tab === 'code' && <CodePanel />}
        {tab === 'git' && <GitPanel />}
      </div>
    </div>
  )
}
