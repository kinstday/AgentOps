import { useAppState } from '../store/appStore'
import type { Alert } from '../types/events'

const LEVEL_STYLE: Record<Alert['level'], { color: string; tag: string }> = {
  CRIT: { color: 'var(--red)', tag: 'CRIT' },
  WARN: { color: 'var(--amber)', tag: 'WARN' },
  OK: { color: 'var(--mint)', tag: 'OK' },
  INFO: { color: 'var(--cyan)', tag: 'INFO' },
}

/** §FR-6 告警滚动条：由规则引擎告警驱动，悬停暂停（CSS :hover）。 */
export default function Ticker() {
  const { alerts, mode } = useAppState()
  const items = alerts.length
    ? alerts
    : [{ key: 'placeholder', level: 'INFO', title: '', message: mode === 'demo' ? '演示模式运行中，暂无告警' : '系统运行正常，暂无告警', ts: '', ephemeral: false } as Alert]
  const loop = [...items, ...items]

  return (
    <div className="border-b border-[var(--line)] bg-[var(--panel)] overflow-hidden" aria-label="实时告警滚动条">
      <div className="ticker-track py-2">
        {loop.map((al, i) => {
          const s = LEVEL_STYLE[al.level]
          return (
            <span key={`${al.key}-${i}`} className="inline-flex items-center gap-2 text-[11.5px] text-[var(--ink-dim)]">
              <span
                className="rounded-sm px-1.5 py-px text-[9px] font-bold tracking-[0.14em]"
                style={{ color: s.color, border: `1px solid ${s.color}` }}
              >
                {s.tag}
              </span>
              {al.message}
            </span>
          )
        })}
      </div>
    </div>
  )
}
