import { useEffect, useState } from 'react'
import Header from '../sections/Header'
import Ticker from '../sections/Ticker'
import AgentFleet from '../sections/AgentFleet'
import DagGraph from '../sections/DagGraph'
import QuotaPanel from '../sections/QuotaPanel'
import GanttChart from '../sections/GanttChart'
import MessageFeed from '../sections/MessageFeed'
import { INITIAL_ACCOUNTS, INITIAL_AGENTS, INITIAL_FEED, type Agent, type FeedMsg } from '../data/mock'

const SIM_LINES: Omit<FeedMsg, 'id' | 'time'>[] = [
  { from: 'coder-frontend', to: 'orchestrator-01', text: 'T-2042 进度 47%：配额卡片组件已拆分为 QuotaCard / QuotaBar', kind: 'report' },
  { from: 'orchestrator-01', to: 'coder-backend', text: '催促：T-2043 审批通过后请在 10 分钟内完成迁移', kind: 'dispatch' },
  { from: 'reviewer-01', to: 'orchestrator-01', text: 'PR #142 复审中，预计 3 分钟出结果', kind: 'report' },
  { from: 'researcher-01', to: 'system', text: '第 3 次重试仍返回 429，退避窗口升至 8 分钟', kind: 'system' },
  { from: 'orchestrator-01', to: 'doc-writer', text: '预派发 T-2046：待发布后更新用户手册配额章节', kind: 'dispatch' },
]

function nowTime() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export default function Home() {
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS)
  const [accounts, setAccounts] = useState(INITIAL_ACCOUNTS)
  const [feed, setFeed] = useState<FeedMsg[]>(INITIAL_FEED)

  // 模拟实时数据：token 增长、倒计时递减、偶发消息（原型演示用）
  useEffect(() => {
    let msgIdx = 0
    let tick = 0
    const t = setInterval(() => {
      tick += 1
      setAgents((prev) =>
        prev.map((a) =>
          a.status === 'running'
            ? { ...a, tokens: a.tokens + Math.floor(18 + Math.random() * 55), cost: a.cost + 0.001 }
            : a,
        ),
      )
      setAccounts((prev) => prev.map((acc) => ({ ...acc, resetInSec: Math.max(0, acc.resetInSec - 1) })))
      if (tick % 7 === 0 && msgIdx < SIM_LINES.length) {
        const line = SIM_LINES[msgIdx]
        msgIdx += 1
        setFeed((prev) => [...prev, { ...line, id: prev.length + 1, time: nowTime() }])
      }
    }, 1000)
    return () => clearInterval(t)
  }, [])

  const togglePause = (id: string) =>
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== id) return a
        if (a.status === 'running') return { ...a, status: 'idle' as const, task: `已暂停 —— ${a.task}` }
        if (a.status === 'idle') return { ...a, status: 'running' as const, task: a.task.replace('已暂停 —— ', '') }
        return a
      }),
    )

  const approve = (id: string, ok: boolean) =>
    setAgents((prev) =>
      prev.map((a) =>
        a.id !== id
          ? a
          : ok
            ? { ...a, status: 'running' as const, task: a.task.replace('（高危操作，等待人工确认）', '（已获批准）') }
            : { ...a, status: 'done' as const, progress: a.progress, task: `${a.task} —— 审批被拒绝，任务取消` },
      ),
    )

  return (
    <div className="app-shell">
      <Header agents={agents} />
      <Ticker />

      <main className="max-w-[1560px] mx-auto px-5 py-5 flex flex-col gap-4">
        <AgentFleet agents={agents} onTogglePause={togglePause} onApprove={approve} />

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 flex flex-col gap-4">
            <DagGraph />
            <GanttChart />
          </div>
          <QuotaPanel accounts={accounts} />
        </div>

        <MessageFeed feed={feed} />
      </main>

      <footer className="border-t border-[var(--line)] py-4">
        <div className="max-w-[1560px] mx-auto px-5 flex items-center justify-between text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase">
          <span>AgentOps Console · 原型 v0.1 · 数据为模拟演示</span>
          <span>数据源接入：Hooks / OTel GenAI / 配额 API（规划中）</span>
        </div>
      </footer>
    </div>
  )
}
