import { useEffect, useState } from 'react'
import type { AgentStatus } from '../types/events'

export const STATUS_META: Record<AgentStatus, { label: string; color: string; pulse: boolean }> = {
  running: { label: '执行中', color: '#22d3ee', pulse: true },
  waiting: { label: '待审批', color: '#fbbf24', pulse: true },
  blocked: { label: '已阻塞', color: '#f87171', pulse: true },
  idle: { label: '空闲', color: '#56678c', pulse: false },
  done: { label: '已完成', color: '#34d399', pulse: false },
  error: { label: '异常', color: '#f87171', pulse: false },
}

export const ACCOUNT_COLORS: Record<string, string> = {
  kimi: '#22d3ee',
  codex: '#34d399',
  deepseek: '#e879f9',
}

export function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const pad = (n: number) => String(n).padStart(2, '0')

/** 秒数 → HH:MM:SS（超过 24h 带天数前缀） */
export function fmtDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec))
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
}

/** ISO 时间戳 → 本地 HH:MM:SS */
export function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 从 ISO 起点到 now 的已运行时长 */
export function elapsedSec(startIso: string | null, now: number): number {
  if (!startIso) return 0
  const t = new Date(startIso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, (now - t) / 1000)
}

/** 到 resetsAt 的剩余秒数（无重置时间返回 null） */
export function resetCountdownSec(resetsAt: string | null, now: number): number | null {
  if (!resetsAt) return null
  const t = new Date(resetsAt).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, (t - now) / 1000)
}

/** 配额余量进度条颜色：≤40% 琥珀、≤15% 红（§FR-4） */
export function quotaBarColor(remainingPct: number): string {
  if (remainingPct <= 15) return 'var(--red)'
  if (remainingPct <= 40) return 'var(--amber)'
  return 'var(--mint)'
}

/** 每 intervalMs 触发重渲染的时钟 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
