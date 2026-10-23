import { useEffect, useState } from 'react'
import { STATUS_META, type Agent } from '../data/mock'

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

export default function Header({ agents }: { agents: Agent[] }) {
  const now = useClock()
  const running = agents.filter((a) => a.status === 'running').length
  const blocked = agents.filter((a) => a.status === 'blocked' || a.status === 'error').length
  const waiting = agents.filter((a) => a.status === 'waiting').length

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <header className="border-b border-[var(--line)] bg-[rgba(5,8,16,0.85)] backdrop-blur-md sticky top-0 z-10">
      <div className="max-w-[1560px] mx-auto px-5 h-[60px] flex items-center gap-4">
        <div className="radar" aria-hidden />
        <div className="leading-tight">
          <div className="text-[15px] font-bold tracking-[0.08em]">AGENTOPS 中控台</div>
          <div className="text-[10px] tracking-[0.22em] text-[var(--ink-mute)] uppercase">
            Multi-Agent Mission Control
          </div>
        </div>

        <span className="ml-2 inline-flex items-center gap-2 rounded-full border border-[rgba(34,211,238,0.4)] px-3 py-1 text-[11px] tracking-[0.14em] text-[var(--cyan)]">
          <span className="led led-pulse" style={{ background: 'var(--cyan)', color: 'var(--cyan)' }} />
          LIVE
        </span>

        <div className="hidden lg:flex items-center gap-5 ml-6 text-[11px] tracking-[0.1em]">
          <span className="text-[var(--ink-dim)]">
            在线代理 <b className="text-[var(--ink)]">{agents.length}</b>
          </span>
          <span className="text-[var(--ink-dim)]">
            执行中 <b style={{ color: STATUS_META.running.color }}>{running}</b>
          </span>
          <span className="text-[var(--ink-dim)]">
            待审批 <b style={{ color: STATUS_META.waiting.color }}>{waiting}</b>
          </span>
          <span className="text-[var(--ink-dim)]">
            阻塞 <b style={{ color: STATUS_META.blocked.color }}>{blocked}</b>
          </span>
        </div>

        <div className="ml-auto flex items-center gap-4">
          <div className="text-right leading-tight hidden sm:block">
            <div className="text-[15px] font-semibold tabular-nums text-[var(--ink)]">
              {pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}
            </div>
            <div className="text-[10px] tracking-[0.18em] text-[var(--ink-mute)] uppercase">本地时间 UTC+8</div>
          </div>
          <div className="w-px h-8 bg-[var(--line)]" />
          <div className="leading-tight">
            <div className="text-[11px] text-[var(--ink)]">白菜</div>
            <div className="text-[10px] text-[var(--ink-mute)] tracking-[0.14em]">OPERATOR</div>
          </div>
        </div>
      </div>
    </header>
  )
}
