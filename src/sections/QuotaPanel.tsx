import { useAppState } from '../store/appStore'
import {
  ACCOUNT_COLORS,
  fmtDuration,
  quotaBarColor,
  resetCountdownSec,
  useNow,
} from '../lib/status'
import type { AccountState } from '../types/events'

/**
 * §FR-4 账号配额：双形态卡片。
 * 窗口型（Kimi Code / ChatGPT-Codex）：大号剩余% + 进度条 + 重置倒计时（秒级）+ 次级窗口 + %/h。
 * 余额型（DeepSeek）：大号 ¥ 余额 + 总额/充值/赠送 + ¥/h + 预计可用天数，无倒计时。
 */

function WindowCard({ acc, sharedCount, now }: { acc: AccountState; sharedCount: number; now: number }) {
  const primary = acc.windows[0]
  if (!primary) return null
  const pct = primary.remaining_pct
  const low = pct <= 15
  const countdown = resetCountdownSec(primary.resets_at, now)
  const rate = primary.rate_per_h
  const etaHours = rate !== null && rate < 0 ? pct / -rate : null

  return (
    <article
      className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3.5"
      style={low ? { borderColor: 'rgba(248,113,113,0.5)' } : undefined}
    >
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="w-2 h-2 rounded-full" style={{ background: ACCOUNT_COLORS[acc.id] ?? 'var(--cyan)' }} aria-hidden />
        <span className="text-[13px] font-semibold">{acc.name}</span>
        {acc.demo && (
          <span className="rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-[var(--amber)] border border-[rgba(251,191,36,0.4)]">
            演示数据
          </span>
        )}
        {sharedCount > 0 && (
          <span className="text-[10px] text-[var(--ink-mute)]">{sharedCount} 个 agent 共享</span>
        )}
        {low && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.1em] text-[var(--red)]">
            <span className="led led-pulse" style={{ background: 'var(--red)', color: 'var(--red)' }} />
            告急
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10px] tracking-[0.12em] text-[var(--ink-mute)] uppercase">{primary.label}剩余</span>
        <span className="text-[20px] font-bold tabular-nums leading-none" style={{ color: quotaBarColor(pct) }}>
          {Math.round(pct)}
          <span className="text-[11px] font-normal">%</span>
        </span>
      </div>
      <div className="qbar mb-2">
        <div
          style={{
            width: `${Math.max(0, Math.min(100, pct))}%`,
            background: quotaBarColor(pct),
            boxShadow: `0 0 8px ${quotaBarColor(pct)}55`,
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-[var(--ink-dim)]">
        <span className="text-[var(--ink-mute)]">重置倒计时</span>
        <span className="text-right tabular-nums">
          {countdown !== null ? fmtDuration(countdown) : '以平台页面为准'}
        </span>
        <span className="text-[var(--ink-mute)]">当前消耗速率</span>
        <span className="text-right tabular-nums">{rate !== null ? `${Math.abs(rate).toFixed(1)}% / h` : '—'}</span>
        <span className="text-[var(--ink-mute)]">预计可用</span>
        <span
          className="text-right tabular-nums"
          style={{ color: etaHours !== null && etaHours < 2 ? 'var(--red)' : undefined }}
        >
          {etaHours === null ? '—' : etaHours >= 24 ? `${(etaHours / 24).toFixed(1)} 天` : `${etaHours.toFixed(1)} 小时`}
        </span>
        {acc.windows.slice(1).map((w) => (
          <span key={w.label} className="contents">
            <span className="text-[var(--ink-mute)]">{w.label}剩余</span>
            <span className="text-right tabular-nums" style={{ color: quotaBarColor(w.remaining_pct) }}>
              {Math.round(w.remaining_pct)}%
            </span>
          </span>
        ))}
      </div>
    </article>
  )
}

function BalanceCard({ acc, now: _now }: { acc: AccountState; now: number }) {
  void _now
  const balance = acc.balance_cny
  const rate = acc.balance_rate_per_h
  // 预计可用天数 = 余额 ÷ 日均消耗（速率 × 24）
  const etaDays = balance !== null && rate !== null && rate < 0 ? balance / (-rate * 24) : null
  const low = etaDays !== null && etaDays < 1

  return (
    <article
      className="rounded-md border border-[var(--line)] bg-[var(--panel)] p-3.5"
      style={low ? { borderColor: 'rgba(248,113,113,0.5)' } : undefined}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="w-2 h-2 rounded-full" style={{ background: ACCOUNT_COLORS[acc.id] ?? 'var(--magenta)' }} aria-hidden />
        <span className="text-[13px] font-semibold">{acc.name}</span>
        <span className="text-[10px] text-[var(--ink-mute)]">{acc.plan ?? '按量计费'}</span>
        {acc.demo && (
          <span className="rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-[var(--amber)] border border-[rgba(251,191,36,0.4)]">
            演示数据
          </span>
        )}
        {low && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[10px] font-bold tracking-[0.1em] text-[var(--red)]">
            <span className="led led-pulse" style={{ background: 'var(--red)', color: 'var(--red)' }} />
            告急
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] tracking-[0.12em] text-[var(--ink-mute)] uppercase">账户余额</span>
        <span
          className="text-[20px] font-bold tabular-nums leading-none"
          style={{ color: low ? 'var(--red)' : 'var(--ink)' }}
        >
          <span className="text-[11px] font-normal">¥</span>
          {balance !== null ? balance.toFixed(2) : '—'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px] text-[var(--ink-dim)]">
        <span className="text-[var(--ink-mute)]">总额 / 充值 / 赠送</span>
        <span className="text-right tabular-nums">
          {acc.balance_detail
            ? `¥${acc.balance_detail.total.toFixed(2)} / ¥${acc.balance_detail.topped_up.toFixed(2)} / ¥${acc.balance_detail.granted.toFixed(2)}`
            : '—'}
        </span>
        <span className="text-[var(--ink-mute)]">当前消耗速率</span>
        <span className="text-right tabular-nums">{rate !== null ? `¥${Math.abs(rate).toFixed(2)} / h` : '—'}</span>
        <span className="text-[var(--ink-mute)]">预计可用天数</span>
        <span className="text-right tabular-nums" style={{ color: low ? 'var(--red)' : undefined }}>
          {etaDays !== null ? `${etaDays.toFixed(1)} 天` : '—'}
        </span>
      </div>
    </article>
  )
}

/** 派单建议：窗口型互比余量取最高，DeepSeek 余额型兜底；不做跨形态换算（§FR-4）。 */
function deriveSuggestion(accounts: AccountState[]): string {
  const windows = accounts.filter((a) => a.quota_kind === 'window' && a.windows.length > 0)
  const balance = accounts.find((a) => a.quota_kind === 'balance')
  const stopped = windows.filter((a) => a.windows[0].remaining_pct < 15)
  const usable = windows.filter((a) => a.windows[0].remaining_pct >= 15)
  const parts: string[] = []
  if (stopped.length > 0) {
    parts.push(`${stopped.map((a) => a.name).join('、')} 余量不足 15%，建议停用`)
  }
  if (usable.length > 0) {
    const best = usable.reduce((x, y) => (x.windows[0].remaining_pct >= y.windows[0].remaining_pct ? x : y))
    parts.push(`窗口型账号中 ${best.name} 余量最高（${Math.round(best.windows[0].remaining_pct)}%），重任务优先路由到该账号`)
  } else if (balance) {
    parts.push(`窗口型账号全部告急，建议切换到 ${balance.name} 按量计费兜底`)
  }
  if (balance && balance.balance_cny !== null && balance.balance_rate_per_h !== null && balance.balance_rate_per_h < 0) {
    const days = balance.balance_cny / (-balance.balance_rate_per_h * 24)
    if (days < 1) parts.push(`${balance.name} 余额预计可用不足 1 天，建议充值后再派单`)
  }
  return parts.length > 0 ? parts.join('；') + '。' : '各账号余量充足，按需派发即可。'
}

export default function QuotaPanel() {
  const { accounts, agents } = useAppState()
  const now = useNow(1000)

  return (
    <section className="panel p-4" aria-label="AI 账号配额">
      <div className="flex items-center justify-between mb-3">
        <h2 className="panel-title">账号配额 · Quota</h2>
        <span className="text-[10px] tracking-[0.14em] text-[var(--ink-mute)] uppercase">{accounts.length} 个账号</span>
      </div>

      <div className="flex flex-col gap-3">
        {accounts.map((acc) => {
          const shared = acc.quota_kind === 'window' ? agents.filter((a) => a.account_id === acc.id).length : 0
          return acc.quota_kind === 'balance' ? (
            <BalanceCard key={acc.id} acc={acc} now={now} />
          ) : (
            <WindowCard key={acc.id} acc={acc} sharedCount={shared} now={now} />
          )
        })}
        {accounts.length === 0 && (
          <div className="rounded-md border border-dashed border-[var(--line)] py-8 text-center text-[12px] text-[var(--ink-mute)]">
            暂无账号配额数据
          </div>
        )}
      </div>

      {accounts.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed border-[var(--line)] p-3 text-[11px] leading-relaxed text-[var(--ink-dim)]">
          <span className="text-[var(--cyan)] font-semibold">派单建议：</span>
          {deriveSuggestion(accounts)}
        </div>
      )}
    </section>
  )
}
