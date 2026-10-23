import type { Account } from '../data/mock'

function fmtCountdown(sec: number) {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
}

function barColor(remaining: number) {
  if (remaining <= 15) return 'var(--red)'
  if (remaining <= 40) return 'var(--amber)'
  return 'var(--mint)'
}

export default function QuotaPanel({ accounts }: { accounts: Account[] }) {
  return (
    <section className="panel p-4" aria-label="AI 账号配额">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">账号配额 · Quota</h2>
        <span className="text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase">{accounts.length} 个账号</span>
      </div>

      <div className="flex flex-col gap-3">
        {accounts.map((acc) => {
          const low = acc.remaining <= 15
          const etaHours = acc.burnPerHour > 0 ? acc.remaining / acc.burnPerHour : Infinity
          return (
            <article
              key={acc.id}
              className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3.5"
              style={low ? { borderColor: 'rgba(248,113,113,0.5)' } : undefined}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full" style={{ background: acc.color }} aria-hidden />
                <span className="text-[13px] font-semibold">{acc.name}</span>
                <span className="text-[10px] text-[var(--ink-mute)]">{acc.plan}</span>
                {low && (
                  <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.1em] text-[var(--red)]">
                    <span className="led led-pulse" style={{ background: 'var(--red)', color: 'var(--red)' }} />
                    告急
                  </span>
                )}
              </div>

              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[10px] tracking-[0.12em] text-[var(--ink-mute)] uppercase">
                  {acc.windowLabel}剩余
                </span>
                <span
                  className="text-[20px] font-bold tabular-nums leading-none"
                  style={{ color: barColor(acc.remaining) }}
                >
                  {acc.remaining}
                  <span className="text-[11px] font-normal">%</span>
                </span>
              </div>
              <div className="qbar mb-2">
                <div
                  style={{
                    width: `${acc.remaining}%`,
                    background: barColor(acc.remaining),
                    boxShadow: `0 0 8px ${barColor(acc.remaining)}55`,
                  }}
                />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-[var(--ink-dim)]">
                <span className="text-[var(--ink-mute)]">重置倒计时</span>
                <span className="text-right tabular-nums">{fmtCountdown(acc.resetInSec)}</span>
                <span className="text-[var(--ink-mute)]">当前消耗速率</span>
                <span className="text-right tabular-nums">{acc.burnPerHour.toFixed(1)}% / h</span>
                <span className="text-[var(--ink-mute)]">预计可用</span>
                <span className="text-right tabular-nums" style={{ color: etaHours < 2 ? 'var(--red)' : undefined }}>
                  {etaHours === Infinity ? '—' : etaHours >= 24 ? `${(etaHours / 24).toFixed(1)} 天` : `${etaHours.toFixed(1)} 小时`}
                </span>
                {acc.weeklyRemaining !== undefined && (
                  <>
                    <span className="text-[var(--ink-mute)]">周限额剩余</span>
                    <span className="text-right tabular-nums">{acc.weeklyRemaining}%</span>
                  </>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <div className="mt-3 rounded-md border border-dashed border-[var(--line)] p-3 text-[11px] leading-relaxed text-[var(--ink-dim)]">
        <span className="text-[var(--cyan)] font-semibold">派单建议：</span>
        Codex 窗口即将耗尽，建议把后续代码任务路由到 Kimi Code（余量 78%）。
      </div>
    </section>
  )
}
