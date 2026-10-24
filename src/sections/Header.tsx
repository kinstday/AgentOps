import { useAppState } from '../store/appStore'
import { STATUS_META, useNow } from '../lib/status'

const MODE_META = {
  live: { label: 'LIVE', color: 'var(--cyan)', border: 'rgba(34,211,238,0.4)' },
  demo: { label: 'DEMO', color: 'var(--amber)', border: 'rgba(251,191,36,0.45)' },
  connecting: { label: '连接中', color: 'var(--ink-mute)', border: 'var(--line)' },
} as const

export default function Header() {
  const { agents, mode } = useAppState()
  const now = useNow(1000)
  const running = agents.filter((a) => a.status === 'running').length
  const blocked = agents.filter((a) => a.status === 'blocked' || a.status === 'error').length
  const waiting = agents.filter((a) => a.status === 'waiting').length
  const m = MODE_META[mode]

  const d = new Date(now)
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

        <span
          className="ml-2 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] tracking-[0.14em]"
          style={{ color: m.color, borderColor: m.border }}
          title={mode === 'demo' ? '后端不可达，当前为演示模式（mock 数据）' : undefined}
        >
          <span
            className={`led ${mode === 'connecting' ? '' : 'led-pulse'}`}
            style={{ background: m.color, color: m.color }}
          />
          {m.label}
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
              {pad(d.getHours())}:{pad(d.getMinutes())}:{pad(d.getSeconds())}
            </div>
            <div className="text-[10px] tracking-[0.18em] text-[var(--ink-mute)] uppercase">本地时间</div>
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
