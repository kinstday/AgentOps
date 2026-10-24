import { useMemo, useState } from 'react'
import { useAppState } from '../store/appStore'
import { STATUS_META, useNow } from '../lib/status'
import type { AgentStatus } from '../types/events'

const WINDOWS = [
  { key: '48m', label: '48m', ms: 48 * 60_000 },
  { key: '3h', label: '3h', ms: 3 * 3_600_000 },
  { key: '24h', label: '24h', ms: 24 * 3_600_000 },
] as const

function tickLabel(ms: number): string {
  if (ms % 3_600_000 === 0) return `-${ms / 3_600_000}h`
  return `-${Math.round(ms / 60_000)}m`
}

/** §FR-3 执行时间线：数据来自 tasks 记录，48m / 3h / 24h 可切换，右缘 NOW 标线随真实时间。 */
export default function GanttChart() {
  const { agents, tasks } = useAppState()
  const now = useNow(1000)
  const [win, setWin] = useState<(typeof WINDOWS)[number]['key']>('48m')
  const spanMs = WINDOWS.find((w) => w.key === win)!.ms
  const windowStart = now - spanMs

  const rows = useMemo(() => {
    const agentName = new Map(agents.map((a) => [a.id, a.name]))
    const byAgent = new Map<string, { label: string; bars: { start: number; end: number; label: string; status: AgentStatus; title: string }[] }>()

    for (const t of tasks) {
      if (!t.agent_id || !t.started_at) continue
      const start = new Date(t.started_at).getTime()
      const end = t.ended_at ? new Date(t.ended_at).getTime() : now
      if (Number.isNaN(start) || end < windowStart || start > now) continue
      const agent = agents.find((a) => a.id === t.agent_id)
      const barStatus: AgentStatus =
        t.status === 'running' ? (agent?.status === 'running' ? 'running' : (agent?.status ?? 'running')) : t.status
      const row = byAgent.get(t.agent_id) ?? { label: agentName.get(t.agent_id) ?? t.agent_id, bars: [] }
      row.bars.push({
        start: Math.max(start, windowStart),
        end: Math.min(end, now),
        label: `${t.id} ${t.title ?? ''}`.trim(),
        status: barStatus,
        title: `${t.id} · ${t.title ?? '未命名'} · ${STATUS_META[barStatus].label}`,
      })
      byAgent.set(t.agent_id, row)
    }
    return [...byAgent.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [agents, tasks, now, windowStart])

  const ticks = [4, 3, 2, 1, 0].map((i) => (spanMs / 4) * i)

  return (
    <section className="panel p-4 flex-1" aria-label="任务时间线">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h2 className="panel-title">执行时间线 · Timeline</h2>
        <div className="flex gap-1.5" role="tablist" aria-label="时间窗口">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              role="tab"
              aria-selected={win === w.key}
              onClick={() => setWin(w.key)}
              className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[10px] tracking-[0.08em] transition-colors duration-150 ${
                win === w.key
                  ? 'border-[var(--cyan)] text-[var(--cyan)] bg-[rgba(34,211,238,0.08)]'
                  : 'border-[var(--line)] text-[var(--ink-mute)] hover:text-[var(--ink-dim)]'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <div className="flex justify-between text-[9.5px] text-[var(--ink-mute)] tabular-nums mb-2 pl-[110px] pr-1">
          {ticks.map((t) => (
            <span key={t}>{t === 0 ? 'NOW' : tickLabel(t)}</span>
          ))}
        </div>

        <div className="relative">
          <div className="absolute top-0 bottom-0 w-px bg-[var(--cyan)] opacity-70 right-1" aria-hidden />

          <div className="flex flex-col gap-2 pt-1">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center gap-2">
                <div className="w-[102px] flex-none text-[10.5px] text-[var(--ink-dim)] truncate">{row.label}</div>
                <div className="relative flex-1 h-[22px] rounded bg-[var(--panel)] border border-[var(--line-soft)]">
                  {row.bars.map((b, i) => {
                    const left = ((b.start - windowStart) / spanMs) * 100
                    const width = Math.max(0.8, ((b.end - b.start) / spanMs) * 100)
                    const c = STATUS_META[b.status].color
                    return (
                      <div
                        key={i}
                        title={b.title}
                        className="absolute top-[3px] h-[14px] rounded-sm flex items-center px-1.5 overflow-hidden"
                        style={{
                          left: `${left}%`,
                          width: `${Math.min(width, 100 - left)}%`,
                          background: `${c}22`,
                          border: `1px solid ${c}`,
                        }}
                      >
                        <span className="text-[9px] whitespace-nowrap" style={{ color: c }}>
                          {b.label}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <div className="rounded-md border border-dashed border-[var(--line)] py-8 text-center text-[12px] text-[var(--ink-mute)]">
                当前时间窗口内没有任务记录
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
