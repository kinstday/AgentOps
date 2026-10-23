import { useState } from 'react'
import { STATUS_META, type Agent, type AgentStatus } from '../data/mock'

const FILTERS: { key: AgentStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '执行中' },
  { key: 'waiting', label: '待审批' },
  { key: 'blocked', label: '阻塞' },
  { key: 'idle', label: '空闲' },
  { key: 'done', label: '已完成' },
]

function fmtTokens(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

interface Props {
  agents: Agent[]
  onTogglePause: (id: string) => void
  onApprove: (id: string, ok: boolean) => void
}

export default function AgentFleet({ agents, onTogglePause, onApprove }: Props) {
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all')
  const list = filter === 'all' ? agents : agents.filter((a) => a.status === filter)

  return (
    <section className="panel p-4" aria-label="Agent 舰队">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h2 className="panel-title">Agent 舰队 · Fleet</h2>
        <div className="flex gap-1.5 flex-wrap" role="tablist" aria-label="按状态筛选">
          {FILTERS.map((f) => {
            const active = filter === f.key
            const count = f.key === 'all' ? agents.length : agents.filter((a) => a.status === f.key).length
            return (
              <button
                key={f.key}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f.key)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-[11px] tracking-[0.08em] transition-colors duration-150 ${
                  active
                    ? 'border-[var(--cyan)] text-[var(--cyan)] bg-[rgba(34,211,238,0.08)]'
                    : 'border-[var(--line)] text-[var(--ink-mute)] hover:text-[var(--ink-dim)] hover:border-[#26344f]'
                }`}
              >
                {f.label} {count}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((a) => {
          const meta = STATUS_META[a.status]
          return (
            <article
              key={a.id}
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3.5 flex flex-col gap-3 transition-colors duration-150 hover:border-[#26344f]"
              style={{ borderLeft: `3px solid ${meta.color}` }}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`led ${meta.pulse ? 'led-pulse' : ''}`}
                  style={{ background: meta.color, color: meta.color }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold truncate">{a.name}</div>
                  <div className="text-[10px] tracking-[0.16em] text-[var(--ink-mute)] uppercase">{a.role}</div>
                </div>
                <span
                  className="ml-auto rounded-sm px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em]"
                  style={{ color: meta.color, border: `1px solid ${meta.color}` }}
                >
                  {meta.label}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <span className="rounded bg-[var(--panel-2)] border border-[var(--line)] px-2 py-0.5 text-[var(--ink)]">
                  {a.model}
                </span>
                <span className="text-[var(--ink-mute)]">{a.modelVendor}</span>
                <span className="ml-auto text-[var(--ink-mute)]">账号 · {a.account}</span>
              </div>

              <p className="text-[12px] leading-relaxed text-[var(--ink-dim)] min-h-[36px]">
                <span className="text-[var(--ink-mute)]">[{a.taskId}]</span> {a.task}
              </p>

              <div>
                <div className="flex justify-between text-[10px] text-[var(--ink-mute)] mb-1.5 tracking-[0.1em]">
                  <span>进度 {a.progress}%</span>
                  <span>已运行 {a.startedAgo}</span>
                </div>
                <div className="qbar">
                  <div
                    style={{
                      width: `${a.progress}%`,
                      background: meta.color,
                      boxShadow: `0 0 8px ${meta.color}66`,
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[var(--ink-dim)] border-t border-[var(--line-soft)] pt-2.5">
                <span className="tabular-nums">
                  {fmtTokens(a.tokens)} tok · ¥{a.cost.toFixed(2)}
                </span>
                <div className="flex gap-1.5">
                  {a.status === 'waiting' ? (
                    <>
                      <button
                        onClick={() => onApprove(a.id, true)}
                        className="cursor-pointer rounded border border-[var(--mint)] text-[var(--mint)] px-2 py-0.5 text-[10px] tracking-[0.1em] hover:bg-[rgba(52,211,153,0.1)] transition-colors duration-150"
                      >
                        批准
                      </button>
                      <button
                        onClick={() => onApprove(a.id, false)}
                        className="cursor-pointer rounded border border-[var(--red)] text-[var(--red)] px-2 py-0.5 text-[10px] tracking-[0.1em] hover:bg-[rgba(248,113,113,0.1)] transition-colors duration-150"
                      >
                        拒绝
                      </button>
                    </>
                  ) : a.status === 'done' || a.status === 'error' ? null : (
                    <button
                      onClick={() => onTogglePause(a.id)}
                      className="cursor-pointer rounded border border-[var(--line)] text-[var(--ink-dim)] px-2 py-0.5 text-[10px] tracking-[0.1em] hover:border-[var(--amber)] hover:text-[var(--amber)] transition-colors duration-150"
                    >
                      {a.status === 'idle' ? '恢复' : '暂停'}
                    </button>
                  )}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {list.length === 0 && (
        <div className="rounded-md border border-dashed border-[var(--line)] py-10 text-center text-[12px] text-[var(--ink-mute)]">
          当前状态下没有代理
        </div>
      )}
    </section>
  )
}
