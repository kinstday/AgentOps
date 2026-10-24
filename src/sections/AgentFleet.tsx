import { useState } from 'react'
import { useAppState, agentAction, openCommander } from '../store/appStore'
import { STATUS_META, elapsedSec, fmtDuration, fmtTokens, useNow } from '../lib/status'
import type { AgentStatus } from '../types/events'

const FILTERS: { key: AgentStatus | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'running', label: '执行中' },
  { key: 'waiting', label: '待审批' },
  { key: 'blocked', label: '阻塞' },
  { key: 'idle', label: '空闲' },
  { key: 'done', label: '已完成' },
]

const BTN =
  'cursor-pointer rounded border px-2 py-0.5 text-[10px] tracking-[0.1em] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40'

/** FR-1 Agent 舰队：状态 + 已运行时长（实时走动）+ token/成本；M1 不展示进度条。 */
export default function AgentFleet() {
  const { agents, accounts, mode } = useAppState()
  const now = useNow(1000)
  const [filter, setFilter] = useState<AgentStatus | 'all'>('all')
  const [notices, setNotices] = useState<Record<string, string>>({})

  const list = filter === 'all' ? agents : agents.filter((a) => a.status === filter)
  const accountName = (id: string | null) => accounts.find((x) => x.id === id)?.name ?? id ?? '—'

  const act = async (id: string, action: 'pause' | 'resume' | 'approve' | 'reject') => {
    const err = await agentAction(id, action)
    setNotices((prev) => {
      const next = { ...prev }
      if (err) next[id] = err
      else delete next[id]
      return next
    })
  }

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
          const task = a.current_task ?? null
          const elapsed = fmtDuration(elapsedSec(task?.started_at ?? a.created_at, now))
          const notice = notices[a.id]
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
                  <div className="text-[10px] tracking-[0.16em] text-[var(--ink-mute)] uppercase">{a.role ?? '—'}</div>
                </div>
                {a.readonly && (
                  <span className="rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-[var(--ink-mute)] border border-[var(--line)]">
                    只读
                  </span>
                )}
                <span
                  className="ml-auto rounded-sm px-1.5 py-0.5 text-[9px] font-bold tracking-[0.12em]"
                  style={{ color: meta.color, border: `1px solid ${meta.color}` }}
                >
                  {meta.label}
                </span>
              </div>

              <div className="flex items-center gap-2 text-[11px]">
                <span className="rounded bg-[var(--panel-2)] border border-[var(--line)] px-2 py-0.5 text-[var(--ink)]">
                  {a.model ?? '未知模型'}
                </span>
                <span className="text-[var(--ink-mute)]">{a.vendor ?? ''}</span>
                <span className="ml-auto text-[var(--ink-mute)] truncate">账号 · {accountName(a.account_id)}</span>
              </div>

              <p className="text-[12px] leading-relaxed text-[var(--ink-dim)] min-h-[36px]">
                {task ? (
                  <>
                    <span className="text-[var(--ink-mute)]">[{task.id}]</span> {task.title ?? '未命名任务'}
                  </>
                ) : (
                  <span className="text-[var(--ink-mute)]">当前无任务</span>
                )}
              </p>
              {a.status === 'blocked' && a.blocked_reason && (
                <p className="text-[11px] text-[var(--red)] -mt-2">阻塞原因：{a.blocked_reason}</p>
              )}

              <div className="flex items-center justify-between text-[10px] text-[var(--ink-mute)] tracking-[0.1em]">
                <span>
                  已运行 <span className="tabular-nums text-[var(--ink-dim)]">{elapsed}</span>
                </span>
                <span className="tabular-nums text-[var(--ink-dim)]">
                  {fmtTokens(a.tokens)} tok · ¥{a.cost.toFixed(2)}
                </span>
              </div>

              {notice && <p className="text-[10px] text-[var(--amber)]">{notice}</p>}

              <div className="flex items-center justify-end gap-1.5 border-t border-[var(--line-soft)] pt-2.5">
                {a.status === 'waiting' ? (
                  <>
                    <button
                      onClick={() => void act(a.id, 'approve')}
                      disabled={a.readonly && mode === 'live'}
                      title={a.readonly ? '该来源只读' : undefined}
                      className={`${BTN} border-[var(--mint)] text-[var(--mint)] hover:bg-[rgba(52,211,153,0.1)]`}
                    >
                      批准
                    </button>
                    <button
                      onClick={() => void act(a.id, 'reject')}
                      disabled={a.readonly && mode === 'live'}
                      title={a.readonly ? '该来源只读' : undefined}
                      className={`${BTN} border-[var(--red)] text-[var(--red)] hover:bg-[rgba(248,113,113,0.1)]`}
                    >
                      拒绝
                    </button>
                  </>
                ) : a.status === 'done' || a.status === 'error' ? null : (
                  <button
                    onClick={() => void act(a.id, a.status === 'running' ? 'pause' : 'resume')}
                    disabled={a.readonly}
                    title={a.readonly ? '该来源只读，无控制通道' : undefined}
                    className={`${BTN} border-[var(--line)] text-[var(--ink-dim)] hover:border-[var(--amber)] hover:text-[var(--amber)]`}
                  >
                    {a.status === 'running' ? '暂停' : '恢复'}
                  </button>
                )}
                <button
                  onClick={() => openCommander(a.id)}
                  disabled={a.readonly}
                  title={a.readonly ? '该 agent 只读，无法对话' : `与 ${a.name} 对话`}
                  className={`${BTN} border-[var(--line)] text-[var(--ink-dim)] hover:border-[var(--cyan)] hover:text-[var(--cyan)]`}
                >
                  对话
                </button>
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
