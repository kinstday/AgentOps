import { useEffect, useRef } from 'react'
import type { FeedMsg } from '../data/mock'

const KIND_STYLE: Record<FeedMsg['kind'], { color: string; label: string }> = {
  dispatch: { color: 'var(--cyan)', label: '派发' },
  report: { color: 'var(--mint)', label: '回报' },
  hitl: { color: 'var(--amber)', label: '审批' },
  system: { color: 'var(--ink-mute)', label: '系统' },
}

export default function MessageFeed({ feed }: { feed: FeedMsg[] }) {
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boxRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [feed.length])

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
        {feed.map((m) => {
          const k = KIND_STYLE[m.kind]
          return (
            <div
              key={m.id}
              className="rounded border border-[var(--line-soft)] bg-[var(--panel)] px-3 py-2"
              style={{ borderLeft: `3px solid ${k.color}` }}
            >
              <div className="flex items-center gap-2 text-[10px] mb-1">
                <span className="tabular-nums text-[var(--ink-mute)]">{m.time}</span>
                <span className="font-semibold" style={{ color: k.color }}>
                  [{k.label}]
                </span>
                <span className="text-[var(--ink-dim)] truncate">
                  {m.from} → {m.to}
                </span>
              </div>
              <p className="text-[11.5px] leading-relaxed text-[var(--ink-dim)]">{m.text}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
