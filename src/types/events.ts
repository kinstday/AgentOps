/**
 * 与后端共享的事件模型与领域类型（复制自 server/src/core/events.ts 与
 * server/src/core/aggregate.ts，按实施计划要求复制而非跨工程引用）。
 */

export const EVENT_TYPES = [
  'agent.register',
  'task.start',
  'task.progress',
  'task.done',
  'task.error',
  'task.dispatch',
  'agent.blocked',
  'agent.resumed',
  'message.send',
  'approval.request',
  'quota.snapshot',
  'command.send',
  'command.reply',
  'dag.propose',
  'dag.confirm',
  'dag.reject',
] as const

export type EventType = (typeof EVENT_TYPES)[number]

export type SourceName = 'kimi-code' | 'codex' | 'deepseek-otel' | 'mock' | 'system'

export interface AgentEvent {
  id: string
  ts: string
  source: SourceName
  agent_id: string | null
  type: EventType
  payload: Record<string, unknown>
}

// ---------- 聚合层当前态（GET /api/state 形状） ----------

export type AgentStatus = 'running' | 'waiting' | 'blocked' | 'idle' | 'done' | 'error'

export interface TaskState {
  id: string
  local_task_id: string | null
  agent_id: string | null
  from_agent: string | null
  title: string | null
  progress: number
  tokens: number
  cost: number
  estimated: boolean
  status: 'running' | 'done' | 'error'
  started_at: string | null
  ended_at: string | null
}

export interface AgentState {
  id: string
  name: string
  role: string | null
  model: string | null
  vendor: string | null
  account_id: string | null
  source: SourceName
  readonly: boolean
  status: AgentStatus
  current_task_id: string | null
  tokens: number
  cost: number
  blocked_since: string | null
  blocked_reason: string | null
  last_event_ts: string
  created_at: string
  /** snapshot 时附带 */
  current_task?: TaskState | null
}

export interface QuotaWindow {
  label: string
  remaining_pct: number
  resets_at: string | null
  rate_per_h: number | null
}

export interface AccountState {
  id: string
  name: string
  plan: string | null
  quota_kind: 'balance' | 'window'
  demo: boolean
  balance_cny: number | null
  balance_detail: { total: number; granted: number; topped_up: number } | null
  balance_rate_per_h: number | null
  windows: QuotaWindow[]
  updated_at: string | null
}

export interface Alert {
  key: string
  level: 'CRIT' | 'WARN' | 'OK' | 'INFO'
  title: string
  message: string
  ts: string
  ephemeral: boolean
}

export interface DispatchEdge {
  from_agent: string | null
  to_agent: string | null
  task_id: string
  ts: string
}

export interface FeedMessage {
  ts: string
  from: string | null
  to: string | null
  kind: string
  text: string
}

export interface CommanderInfo {
  backend: string
  degraded: boolean
}

export interface StateSnapshot {
  ts: string
  agents: AgentState[]
  tasks: TaskState[]
  accounts: AccountState[]
  alerts: Alert[]
  messages: FeedMessage[]
  dispatches: DispatchEdge[]
  commander?: CommanderInfo
}

/** commands 表行（GET /api/command/history） */
export interface CommandRecord {
  id: string
  ts: string
  target: string
  direction: 'in' | 'out'
  text: string
  cost_tokens: number
}
