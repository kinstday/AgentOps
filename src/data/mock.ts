import type {
  AccountState,
  AgentState,
  Alert,
  DispatchEdge,
  FeedMessage,
  TaskState,
} from '../types/events'
import { nowIsoLocal } from '../api/client'

/**
 * 演示模式专用数据源（§11 降级：无数据源接入时以 mock 数据运行并明确标注）。
 * 口径按文档：三个账号来源 —— Kimi Code（窗口型）、ChatGPT/Codex（窗口型）、
 * DeepSeek API（余额型）。
 */

function isoOffset(ms: number): string {
  return nowIsoLocal(new Date(Date.now() + ms))
}

function agoIso(ms: number): string {
  return isoOffset(-ms)
}

export function demoTasks(): TaskState[] {
  return [
    {
      id: 'T-2041', local_task_id: null, agent_id: 'orchestrator-01', from_agent: null,
      title: '拆解「电商大促看板」需求并派发给子代理', progress: 0, tokens: 48210, cost: 0.86,
      estimated: false, status: 'running', started_at: agoIso(41 * 60_000 + 7_000), ended_at: null,
    },
    {
      id: 'T-2042', local_task_id: null, agent_id: 'coder-frontend', from_agent: 'orchestrator-01',
      title: '重构配额面板组件，接入 WebSocket 实时推送', progress: 0, tokens: 128450, cost: 3.42,
      estimated: false, status: 'running', started_at: agoIso(33 * 60_000 + 52_000), ended_at: null,
    },
    {
      id: 'T-2043', local_task_id: null, agent_id: 'coder-backend', from_agent: 'orchestrator-01',
      title: '执行数据库迁移脚本（高危操作，等待人工确认）', progress: 0, tokens: 96320, cost: 2.87,
      estimated: false, status: 'running', started_at: agoIso(27 * 60_000 + 18_000), ended_at: null,
    },
    {
      id: 'T-2044', local_task_id: null, agent_id: 'reviewer-01', from_agent: 'coder-frontend',
      title: '审查 PR #142：配额预测算法边界条件', progress: 0, tokens: 34780, cost: 0.21,
      estimated: false, status: 'running', started_at: agoIso(18 * 60_000 + 44_000), ended_at: null,
    },
    {
      id: 'T-2045', local_task_id: null, agent_id: 'researcher-01', from_agent: 'orchestrator-01',
      title: '抓取竞品定价页面（API 速率受限，排队重试）', progress: 0, tokens: 15230, cost: 0.44,
      estimated: false, status: 'running', started_at: agoIso(12 * 60_000 + 6_000), ended_at: null,
    },
    {
      id: 'T-2039', local_task_id: null, agent_id: 'doc-writer', from_agent: 'orchestrator-01',
      title: '生成 v2.4 版本发布说明与变更日志', progress: 100, tokens: 58900, cost: 0.67,
      estimated: false, status: 'done', started_at: agoIso(65 * 60_000 + 39_000), ended_at: agoIso(2 * 60_000),
    },
  ]
}

export function demoAgents(tasks: TaskState[]): AgentState[] {
  const taskOf = (id: string) => tasks.find((t) => t.id === id) ?? null
  const base = {
    blocked_since: null as string | null,
    blocked_reason: null as string | null,
    last_event_ts: agoIso(30_000),
  }
  const agents: AgentState[] = [
    {
      id: 'orchestrator-01', name: 'orchestrator-01', role: '任务编排', model: 'Kimi K3',
      vendor: 'Moonshot', account_id: 'kimi', source: 'kimi-code', readonly: false,
      status: 'running', current_task_id: 'T-2041', tokens: 48210, cost: 0.86,
      created_at: agoIso(42 * 60_000), ...base,
    },
    {
      id: 'coder-frontend', name: 'coder-frontend', role: '前端开发', model: 'Kimi K3',
      vendor: 'Moonshot', account_id: 'kimi', source: 'kimi-code', readonly: false,
      status: 'running', current_task_id: 'T-2042', tokens: 128450, cost: 3.42,
      created_at: agoIso(40 * 60_000), ...base,
    },
    {
      id: 'coder-backend', name: 'coder-backend', role: '后端开发', model: 'GPT-5.1 Codex',
      vendor: 'OpenAI', account_id: 'codex', source: 'codex', readonly: false,
      status: 'waiting', current_task_id: 'T-2043', tokens: 96320, cost: 2.87,
      created_at: agoIso(35 * 60_000), ...base,
    },
    {
      id: 'reviewer-01', name: 'reviewer-01', role: '代码审查', model: 'DeepSeek V3.2',
      vendor: 'DeepSeek', account_id: 'deepseek', source: 'deepseek-otel', readonly: true,
      status: 'running', current_task_id: 'T-2044', tokens: 34780, cost: 0.21,
      created_at: agoIso(30 * 60_000), ...base,
    },
    {
      id: 'researcher-01', name: 'researcher-01', role: '调研分析', model: 'GPT-5.1 Codex',
      vendor: 'OpenAI', account_id: 'codex', source: 'codex', readonly: false,
      status: 'blocked', current_task_id: 'T-2045', tokens: 15230, cost: 0.44,
      created_at: agoIso(25 * 60_000),
      blocked_since: agoIso(12 * 60_000), blocked_reason: 'DeepSeek 兼容网关返回 429，指数退避重试中',
      last_event_ts: agoIso(60_000),
    },
    {
      id: 'doc-writer', name: 'doc-writer', role: '文档撰写', model: 'Kimi K3',
      vendor: 'Moonshot', account_id: 'kimi', source: 'kimi-code', readonly: false,
      status: 'done', current_task_id: null, tokens: 58900, cost: 0.67,
      created_at: agoIso(70 * 60_000), ...base,
    },
  ]
  for (const a of agents) a.current_task = a.current_task_id ? taskOf(a.current_task_id) : null
  return agents
}

export function demoAccounts(): AccountState[] {
  return [
    {
      id: 'kimi', name: 'Kimi Code · 会员 · 主号', plan: '会员', quota_kind: 'window', demo: true,
      balance_cny: null, balance_detail: null, balance_rate_per_h: null,
      windows: [
        { label: '5h 窗口', remaining_pct: 62, resets_at: isoOffset(2.7 * 3_600_000), rate_per_h: -3.1 },
        { label: '周限额', remaining_pct: 81, resets_at: null, rate_per_h: -1.2 },
      ],
      updated_at: agoIso(15_000),
    },
    {
      id: 'codex', name: 'ChatGPT/Codex · Plus', plan: 'Plus', quota_kind: 'window', demo: true,
      balance_cny: null, balance_detail: null, balance_rate_per_h: null,
      windows: [
        { label: '5h 窗口', remaining_pct: 12, resets_at: isoOffset(1.05 * 3_600_000), rate_per_h: -14.6 },
        { label: '周限额', remaining_pct: 23, resets_at: null, rate_per_h: -2.4 },
      ],
      updated_at: agoIso(15_000),
    },
    {
      id: 'deepseek', name: 'DeepSeek API', plan: '按量计费', quota_kind: 'balance', demo: true,
      balance_cny: 58.3,
      balance_detail: { total: 58.3, granted: 9.91, topped_up: 48.39 },
      balance_rate_per_h: -0.42,
      windows: [],
      updated_at: agoIso(20_000),
    },
  ]
}

export function demoDispatches(): DispatchEdge[] {
  return [
    { from_agent: 'orchestrator-01', to_agent: 'coder-frontend', task_id: 'T-2042', ts: agoIso(33 * 60_000) },
    { from_agent: 'orchestrator-01', to_agent: 'coder-backend', task_id: 'T-2043', ts: agoIso(27 * 60_000) },
    { from_agent: 'orchestrator-01', to_agent: 'researcher-01', task_id: 'T-2045', ts: agoIso(12 * 60_000) },
    { from_agent: 'coder-frontend', to_agent: 'reviewer-01', task_id: 'T-2044', ts: agoIso(18 * 60_000) },
    { from_agent: 'coder-backend', to_agent: 'reviewer-01', task_id: 'T-2043', ts: agoIso(20 * 60_000) },
    { from_agent: 'orchestrator-01', to_agent: 'doc-writer', task_id: 'T-2039', ts: agoIso(65 * 60_000) },
  ]
}

export function demoMessages(): FeedMessage[] {
  return [
    { ts: agoIso(22 * 60_000), from: 'orchestrator-01', to: 'coder-frontend', kind: '派发', text: '派发 T-2042：配额面板改为 WebSocket 实时推送，注意断线重连' },
    { ts: agoIso(18 * 60_000), from: 'coder-backend', to: 'orchestrator-01', kind: '审批', text: '迁移脚本包含 DROP COLUMN，申请人工审批后继续' },
    { ts: agoIso(17 * 60_000), from: 'orchestrator-01', to: '操作员', kind: '审批', text: 'T-2043 已挂起，等待你的确认（高危操作）' },
    { ts: agoIso(9 * 60_000), from: 'reviewer-01', to: 'coder-frontend', kind: '回报', text: 'PR #142 发现 2 处边界问题：配额为 0 时预测值溢出' },
    { ts: agoIso(6 * 60_000), from: 'researcher-01', to: 'system', kind: '系统', text: '上游接口返回 429，进入指数退避，预计 4 分钟后重试' },
    { ts: agoIso(3 * 60_000), from: 'coder-frontend', to: 'reviewer-01', kind: '回报', text: '已修复溢出并推送 commit 9f3ac21，请复审' },
    { ts: agoIso(2 * 60_000), from: 'doc-writer', to: 'orchestrator-01', kind: '回报', text: 'T-2039 完成，产物：release-notes-v2.4.md' },
  ]
}

/** 演示模式派生告警（口径对齐后端规则引擎 §FR-6）。 */
export function deriveDemoAlerts(accounts: AccountState[], agents: AgentState[], now: number): Alert[] {
  const alerts: Alert[] = []
  for (const acc of accounts) {
    for (const w of acc.windows) {
      if (w.remaining_pct <= 15) {
        alerts.push({
          key: `quota:${acc.id}:${w.label}`, level: 'CRIT', title: '配额告急',
          message: `${acc.name} ${w.label} 剩余 ${w.remaining_pct}%（≤15%），建议停止向该账号派单`,
          ts: nowIsoLocal(), ephemeral: false,
        })
      } else if (w.remaining_pct <= 40) {
        alerts.push({
          key: `quota:${acc.id}:${w.label}`, level: 'WARN', title: '配额偏低',
          message: `${acc.name} ${w.label} 剩余 ${w.remaining_pct}%（≤40%）`,
          ts: nowIsoLocal(), ephemeral: false,
        })
      }
      if (w.resets_at) {
        const msLeft = new Date(w.resets_at).getTime() - now
        if (msLeft > 0 && msLeft < 30 * 60_000) {
          alerts.push({
            key: `reset:${acc.id}:${w.label}`, level: 'INFO', title: '配额即将重置',
            message: `${acc.name} ${w.label} 将在 ${Math.ceil(msLeft / 60_000)} 分钟后重置`,
            ts: nowIsoLocal(), ephemeral: false,
          })
        }
      }
    }
  }
  for (const a of agents) {
    if (a.status === 'blocked' && a.blocked_since) {
      const ms = now - new Date(a.blocked_since).getTime()
      if (ms >= 10 * 60_000) {
        alerts.push({
          key: `blocked:${a.id}`, level: 'WARN', title: 'agent 阻塞超时',
          message: `${a.name} 已阻塞 ${Math.floor(ms / 60_000)} 分钟：${a.blocked_reason ?? '原因未知'}`,
          ts: nowIsoLocal(), ephemeral: false,
        })
      }
    }
    if (a.status === 'waiting') {
      alerts.push({
        key: `waiting:${a.id}`, level: 'WARN', title: '等待审批',
        message: `agent ${a.name} 进入 waiting，等待人工审批`,
        ts: nowIsoLocal(), ephemeral: false,
      })
    }
    if (a.status === 'done' && a.current_task_id === null) {
      alerts.push({
        key: `done:${a.id}`, level: 'OK', title: '任务完成',
        message: `${a.name} 已完成最近任务`,
        ts: nowIsoLocal(), ephemeral: true,
      })
    }
  }
  return alerts
}

/** 演示模式通信流追加语料（循环播放）。 */
export const DEMO_FEED_LINES: Omit<FeedMessage, 'ts'>[] = [
  { from: 'coder-frontend', to: 'orchestrator-01', kind: '回报', text: 'T-2042：配额卡片已拆分为窗口型 / 余额型两种形态' },
  { from: 'orchestrator-01', to: 'coder-backend', kind: '派发', text: '催促：T-2043 审批通过后请在 10 分钟内完成迁移' },
  { from: 'reviewer-01', to: 'orchestrator-01', kind: '回报', text: 'PR #142 复审中，预计 3 分钟出结果' },
  { from: 'researcher-01', to: 'system', kind: '系统', text: '第 3 次重试仍返回 429，退避窗口升至 8 分钟' },
  { from: 'orchestrator-01', to: 'doc-writer', kind: '派发', text: '预派发 T-2046：待发布后更新用户手册配额章节' },
]
