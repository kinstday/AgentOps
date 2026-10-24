import { useEffect, useRef } from 'react'
import { useAppState } from '../store/appStore'
import { fmtTime } from '../lib/status'

/** §FR-5 通信流：由 message.* 事件驱动。kind 支持中英文标签。 */
const KIND_STYLE = (kind: string): { color: string; label: string } => {
  if (kind.includes('派发') || kind === 'dispatch') return { color: 'var(--cyan)', label: '派发' }
  if (kind.includes('回报') || kind === 'report') return { color: 'var(--mint)', label: '回报' }
  if (kind.includes('审批') || kind === 'hitl') return { color: 'var(--amber)', label: '审批' }
  return { color: 'var(--ink-mute)', label: '系统' }
}

export default function MessageFeed() {
  const { messages } = useAppState()
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length])

  return (
    <section className="panel p-4 flex flex-col flex-1" aria-label="Agent 通信流">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">通信流 · A2A Bus</h2>
        <span className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] text-[var(--cyan)]">
          <span className="led led-pulse" style={{ background: 'var(--cyan)', color: 'var(--cyan)' }} />
          STREAMING
        </span>
      </div>

      <div
        ref={boxRef}
        className="grid grid-cols-1 md:grid-cols-2 gap-2.5 overflow-y-auto max-h-[330px] pr-1 content-start"
      >
        {messages.map((m, i) => {
          const k = KIND_STYLE(m.kind)
          return (
            <div
              key={`${m.ts}-${i}`}
              className="rounded border border-[var(--line-soft)] bg-[var(--panel)] px-3 py-2"
              style={{ borderLeft: `3px solid ${k.color}` }}
            >
              <div className="flex items-center gap-2 text-[10px] mb-1">
                <span className="tabular-nums text-[var(--ink-mute)]">{fmtTime(m.ts)}</span>
                <span className="font-semibold" style={{ color: k.color }}>
                  [{k.label}]
                </span>
                <span className="text-[var(--ink-dim)] truncate">
                  {m.from ?? '?'} → {m.to ?? '?'}
                </span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-[var(--ink-dim)]">{m.text}</p>
            </div>
          )
        })}
        {messages.length === 0 && (
          <div className="col-span-full rounded-md border border-dashed border-[var(--line)] py-8 text-center text-[12px] text-[var(--ink-mute)]">
            暂无 message.* 事件
          </div>
        )}
      </div>
    </section>
  )
}
