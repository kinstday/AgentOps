import { useEffect } from 'react'
import Header from '../sections/Header'
import Ticker from '../sections/Ticker'
import AgentFleet from '../sections/AgentFleet'
import DagGraph from '../sections/DagGraph'
import QuotaPanel from '../sections/QuotaPanel'
import GanttChart from '../sections/GanttChart'
import MessageFeed from '../sections/MessageFeed'
import CommanderPanel from '../sections/CommanderPanel'
import { initApp, useAppState } from '../store/appStore'

export default function Home() {
  const { mode, commander } = useAppState()

  // 首屏连接后端（WS → store → 组件）；不可达时自动降级演示模式
  useEffect(() => {
    initApp()
  }, [])

  return (
    <div className="app-shell">
      <Header />
      <Ticker />

      <main className="max-w-[1560px] mx-auto px-5 py-5 flex flex-col gap-4">
        <AgentFleet />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 flex flex-col gap-4">
            <DagGraph />
            <GanttChart />
          </div>
          <QuotaPanel />
        </div>

        <MessageFeed />
      </main>

      <CommanderPanel />

      <footer className="border-t border-[var(--line)] py-4">
        <div className="max-w-[1560px] mx-auto px-5 flex items-center justify-between text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase flex-wrap gap-2">
          <span>
            AgentOps Console · v0.2
            {mode === 'demo' && <span className="text-[var(--amber)]"> · 演示模式（mock 数据，后端未接入）</span>}
            {mode === 'connecting' && ' · 正在连接后端…'}
          </span>
          <span>
            数据源接入：Hooks / OTel GenAI / 配额 API
            {mode === 'live' && commander && ` · 指挥后端 ${commander.backend}${commander.degraded ? '（降级）' : ''}`}
          </span>
        </div>
      </footer>
    </div>
  )
}
