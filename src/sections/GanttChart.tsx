import { GANTT, STATUS_META } from '../data/mock'

const SPAN = 48 // minutes window
const NOW = 48 // "now" marker at the right edge (0m ago)

export default function GanttChart() {
  const ticks = [48, 36, 24, 12, 0]
  return (
    <section className="panel p-4 flex-1" aria-label="任务时间线">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">执行时间线 · Timeline</h2>
        <span className="text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase">近 48 分钟窗口</span>
      </div>

      <div className="relative">
        {/* time scale */}
        <div className="flex justify-between text-[9.5px] text-[var(--ink-mute)] tabular-nums mb-2 pl-[110px] pr-1">
          {ticks.map((t) => (
            <span key={t}>-{t}m</span>
          ))}
        </div>

        <div className="relative">
          {/* now marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-[var(--cyan)] opacity-70"
            style={{ left: `calc(110px + (100% - 110px) * ${NOW / SPAN})` }}
            aria-hidden
          />
          <div
            className="absolute -top-1 text-[9px] text-[var(--cyan)] tracking-[0.1em]"
            style={{ left: `calc(110px + (100% - 110px) * ${NOW / SPAN} - 26px)` }}
          >
            NOW
          </div>

          <div className="flex flex-col gap-2 pt-3">
            {GANTT.map((row) => (
              <div key={row.agent} className="flex items-center gap-2">
                <div className="w-[102px] flex-none text-[10.5px] text-[var(--ink-dim)] truncate">{row.agent}</div>
                <div className="relative flex-1 h-[22px] rounded bg-[var(--panel)] border border-[var(--line-soft)]">
                  {row.bars.map((b, i) => {
                    const left = (b.start / SPAN) * 100
                    const width = ((b.end - b.start) / SPAN) * 100
                    const c = STATUS_META[b.status].color
                    return (
                      <div
                        key={i}
                        title={`${b.label} · ${STATUS_META[b.status].label}`}
                        className="absolute top-[3px] h-[14px] rounded-sm flex items-center px-1.5 overflow-hidden"
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
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
          </div>
        </div>
      </div>
    </section>
  )
}
