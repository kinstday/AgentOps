import { TICKER_ITEMS } from '../data/mock'

const LEVEL_STYLE: Record<string, { color: string; tag: string }> = {
  critical: { color: 'var(--red)', tag: 'CRIT' },
  warn: { color: 'var(--amber)', tag: 'WARN' },
  ok: { color: 'var(--mint)', tag: 'OK' },
  info: { color: 'var(--cyan)', tag: 'INFO' },
}

export default function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS]
  return (
    <div className="border-b border-[var(--line)] bg-[var(--panel)] overflow-hidden" aria-label="实时告警滚动条">
      <div className="ticker-track py-2">
        {items.map((it, i) => {
          const s = LEVEL_STYLE[it.level]
          return (
            <span key={i} className="inline-flex items-center gap-2 text-[11.5px] text-[var(--ink-dim)]">
              <span
                className="rounded-sm px-1.5 py-px text-[9px] font-bold tracking-[0.14em]"
                style={{ color: s.color, border: `1px solid ${s.color}` }}
              >
                {s.tag}
              </span>
              {it.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}
