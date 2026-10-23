export type AgentStatus = 'running' | 'waiting' | 'blocked' | 'idle' | 'done' | 'error'

export interface Agent {
  id: string
  name: string
  role: string
  model: string
  modelVendor: string
  account: string
  status: AgentStatus
  task: string
  taskId: string
  progress: number
  tokens: number
  cost: number
  startedAgo: string
}

export const STATUS_META: Record<AgentStatus, { label: string; color: string; pulse: boolean }> = {
  running: { label: '执行中', color: '#22d3ee', pulse: true },
  waiting: { label: '待审批', color: '#fbbf24', pulse: true },
  blocked: { label: '已阻塞', color: '#f87171', pulse: true },
  idle: { label: '空闲', color: '#56678c', pulse: false },
  done: { label: '已完成', color: '#34d399', pulse: false },
  error: { label: '异常', color: '#f87171', pulse: false },
}

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'orchestrator', name: 'orchestrator-01', role: '任务编排', model: 'Kimi K3',
    modelVendor: 'Moonshot', account: 'Kimi Code', status: 'running',
    task: '拆解「电商大促看板」需求并派发给子代理', taskId: 'T-2041',
    progress: 62, tokens: 48210, cost: 0.86, startedAgo: '00:41:07',
  },
  {
    id: 'frontend', name: 'coder-frontend', role: '前端开发', model: 'Claude Sonnet 4.5',
    modelVendor: 'Anthropic', account: 'Claude Code', status: 'running',
    task: '重构配额面板组件，接入 WebSocket 实时推送', taskId: 'T-2042',
    progress: 45, tokens: 128450, cost: 3.42, startedAgo: '00:33:52',
  },
  {
    id: 'backend', name: 'coder-backend', role: '后端开发', model: 'GPT-5.1 Codex',
    modelVendor: 'OpenAI', account: 'Codex', status: 'waiting',
    task: '执行数据库迁移脚本（高危操作，等待人工确认）', taskId: 'T-2043',
    progress: 71, tokens: 96320, cost: 2.87, startedAgo: '00:27:18',
  },
  {
    id: 'reviewer', name: 'reviewer-01', role: '代码审查', model: 'DeepSeek V3.2',
    modelVendor: 'DeepSeek', account: 'DeepSeek API', status: 'running',
    task: '审查 PR #142：配额预测算法边界条件', taskId: 'T-2044',
    progress: 83, tokens: 34780, cost: 0.21, startedAgo: '00:18:44',
  },
  {
    id: 'researcher', name: 'researcher-01', role: '调研分析', model: 'Gemini 3 Pro',
    modelVendor: 'Google', account: 'Gemini API', status: 'blocked',
    task: '抓取竞品定价页面（API 速率受限，排队重试）', taskId: 'T-2045',
    progress: 12, tokens: 15230, cost: 0.44, startedAgo: '00:12:06',
  },
  {
    id: 'docwriter', name: 'doc-writer', role: '文档撰写', model: 'Qwen3 Max',
    modelVendor: 'Alibaba', account: '百炼 API', status: 'done',
    task: '生成 v2.4 版本发布说明与变更日志', taskId: 'T-2039',
    progress: 100, tokens: 58900, cost: 0.67, startedAgo: '01:05:39',
  },
]

export interface Account {
  id: string
  name: string
  plan: string
  windowLabel: string
  remaining: number // percent
  resetInSec: number
  weeklyRemaining?: number
  burnPerHour: number // percent per hour at current rate
  color: string
}

export const INITIAL_ACCOUNTS: Account[] = [
  {
    id: 'claude', name: 'Claude Code', plan: 'Pro · 主号', windowLabel: '5h 窗口',
    remaining: 34, resetInSec: 2 * 3600 + 14 * 60 + 33, weeklyRemaining: 61, burnPerHour: 9.2, color: '#e879f9',
  },
  {
    id: 'kimi', name: 'Kimi Code', plan: '会员 · 主号', windowLabel: '周配额',
    remaining: 78, resetInSec: 3 * 86400 + 5 * 3600, burnPerHour: 1.8, color: '#22d3ee',
  },
  {
    id: 'codex', name: 'Codex', plan: 'Plus · 备用号', windowLabel: '5h 窗口',
    remaining: 12, resetInSec: 1 * 3600 + 2 * 60 + 48, weeklyRemaining: 23, burnPerHour: 14.6, color: '#34d399',
  },
  {
    id: 'copilot', name: 'Copilot', plan: 'Pro · 团队号', windowLabel: '月配额',
    remaining: 55, resetInSec: 9 * 86400 + 11 * 3600, burnPerHour: 0.9, color: '#fbbf24',
  },
]

export interface DagNode {
  id: string
  label: string
  sub: string
  x: number
  y: number
  status: AgentStatus | 'source' | 'sink'
}

export const DAG_NODES: DagNode[] = [
  { id: 'user', label: '需求输入', sub: '白菜 · 手动触发', x: 60, y: 150, status: 'source' },
  { id: 'orchestrator', label: 'orchestrator-01', sub: 'Kimi K3', x: 230, y: 150, status: 'running' },
  { id: 'frontend', label: 'coder-frontend', sub: 'Claude Sonnet 4.5', x: 430, y: 60, status: 'running' },
  { id: 'backend', label: 'coder-backend', sub: 'GPT-5.1 Codex', x: 430, y: 150, status: 'waiting' },
  { id: 'researcher', label: 'researcher-01', sub: 'Gemini 3 Pro', x: 430, y: 240, status: 'blocked' },
  { id: 'reviewer', label: 'reviewer-01', sub: 'DeepSeek V3.2', x: 630, y: 105, status: 'running' },
  { id: 'deploy', label: '合并 · 发布', sub: '待全部通过', x: 800, y: 150, status: 'sink' },
]

export interface DagEdge {
  from: string
  to: string
  active: boolean
}

export const DAG_EDGES: DagEdge[] = [
  { from: 'user', to: 'orchestrator', active: true },
  { from: 'orchestrator', to: 'frontend', active: true },
  { from: 'orchestrator', to: 'backend', active: true },
  { from: 'orchestrator', to: 'researcher', active: false },
  { from: 'frontend', to: 'reviewer', active: true },
  { from: 'backend', to: 'reviewer', active: false },
  { from: 'reviewer', to: 'deploy', active: true },
]

export interface GanttRow {
  agent: string
  color: string
  bars: { start: number; end: number; label: string; status: AgentStatus }[]
}

export const GANTT: GanttRow[] = [
  { agent: 'orchestrator-01', color: '#22d3ee', bars: [{ start: 2, end: 46, label: 'T-2041 编排派发', status: 'running' }] },
  { agent: 'coder-frontend', color: '#e879f9', bars: [{ start: 9, end: 40, label: 'T-2042 组件重构', status: 'running' }] },
  { agent: 'coder-backend', color: '#34d399', bars: [
    { start: 9, end: 33, label: 'T-2043 迁移脚本', status: 'waiting' },
  ] },
  { agent: 'reviewer-01', color: '#fbbf24', bars: [
    { start: 18, end: 44, label: 'T-2044 PR #142', status: 'running' },
  ] },
  { agent: 'researcher-01', color: '#f87171', bars: [
    { start: 14, end: 21, label: 'T-2045 竞品抓取', status: 'blocked' },
  ] },
  { agent: 'doc-writer', color: '#8fa1c2', bars: [
    { start: 0, end: 12, label: 'T-2039 发布说明', status: 'done' },
  ] },
]

export interface FeedMsg {
  id: number
  time: string
  from: string
  to: string
  text: string
  kind: 'dispatch' | 'report' | 'hitl' | 'system'
}

export const INITIAL_FEED: FeedMsg[] = [
  { id: 1, time: '14:02:11', from: 'orchestrator-01', to: 'coder-frontend', text: '派发 T-2042：配额面板改为 WebSocket 实时推送，注意断线重连', kind: 'dispatch' },
  { id: 2, time: '14:06:38', from: 'coder-backend', to: 'orchestrator-01', text: '迁移脚本包含 DROP COLUMN，申请人工审批后继续', kind: 'hitl' },
  { id: 3, time: '14:09:54', from: 'orchestrator-01', to: '白菜', text: 'T-2043 已挂起，等待你的确认（高危操作）', kind: 'hitl' },
  { id: 4, time: '14:15:20', from: 'reviewer-01', to: 'coder-frontend', text: 'PR #142 发现 2 处边界问题：配额为 0 时预测值溢出', kind: 'report' },
  { id: 5, time: '14:18:03', from: 'researcher-01', to: 'system', text: 'Gemini API 返回 429，进入指数退避，预计 4 分钟后重试', kind: 'system' },
  { id: 6, time: '14:21:47', from: 'coder-frontend', to: 'reviewer-01', text: '已修复溢出并推送 commit 9f3ac21，请复审', kind: 'report' },
  { id: 7, time: '14:24:12', from: 'doc-writer', to: 'orchestrator-01', text: 'T-2039 完成，产物：release-notes-v2.4.md', kind: 'report' },
]

export const TICKER_ITEMS = [
  { level: 'critical', text: 'Codex 账号 5h 窗口配额仅剩 12%，按当前速率约 49 分钟后耗尽' },
  { level: 'warn', text: 'researcher-01 已阻塞 12 分钟：Gemini API 速率受限' },
  { level: 'warn', text: 'coder-backend 等待人工审批：数据库迁移含高危操作' },
  { level: 'ok', text: 'doc-writer 完成 T-2039，耗时 65 分钟，成本 ¥0.67' },
  { level: 'ok', text: 'reviewer-01 完成 PR #141 审查，通过' },
  { level: 'info', text: 'Claude Code 5h 窗口将于 2 小时 14 分钟后重置' },
]
