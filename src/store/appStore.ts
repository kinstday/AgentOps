import { useSyncExternalStore } from 'react'
import type {
  AccountState,
  AgentEvent,
  AgentState,
  Alert,
  CommandRecord,
  CommanderInfo,
  DispatchEdge,
  FeedMessage,
  StateSnapshot,
  TaskState,
} from '../types/events'
import {
  StreamClient,
  fetchCommandHistory,
  fetchState,
  nowIsoLocal,
  postAgentAction,
  postCommand,
  type StreamMessage,
} from '../api/client'
import {
  DEMO_FEED_LINES,
  demoAccounts,
  demoAgents,
  demoDispatches,
  demoMessages,
  demoTasks,
  deriveDemoAlerts,
} from '../data/mock'

/**
 * §8.1-A4 前端单向数据流：WS 事件 → store → 组件渲染。
 * 首屏 GET /api/state 全量对齐 + WS 增量更新，断线重连后重新全量对齐。
 * /api/state 不可达时自动降级演示模式（mock 数据驱动，界面标注 DEMO）。
 */

export type ConnMode = 'connecting' | 'live' | 'demo'

export interface UiCommand extends CommandRecord {
  pending?: boolean
  failed?: boolean
}

export interface AppState {
  mode: ConnMode
  ts: string | null
  agents: AgentState[]
  tasks: TaskState[]
  accounts: AccountState[]
  alerts: Alert[]
  messages: FeedMessage[]
  dispatches: DispatchEdge[]
  commander: CommanderInfo | null
  commands: UiCommand[]
  commanderOpen: boolean
  commanderThread: string
  commanderPrefill: string | null
  commanderPrefillSeq: number
}

const EMPTY: AppState = {
  mode: 'connecting',
  ts: null,
  agents: [],
  tasks: [],
  accounts: [],
  alerts: [],
  messages: [],
  dispatches: [],
  commander: null,
  commands: [],
  commanderOpen: false,
  commanderThread: 'commander',
  commanderPrefill: null,
  commanderPrefillSeq: 0,
}

let state: AppState = EMPTY
const listeners = new Set<() => void>()

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): AppState {
  return state
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getSnapshot)
}

// ---------- 事件应用（镜像后端聚合层口径） ----------

function upsertAgent(list: AgentState[], agent: AgentState): AgentState[] {
  const i = list.findIndex((a) => a.id === agent.id)
  if (i < 0) return [...list, agent]
  const next = list.slice()
  next[i] = agent
  return next
}

function upsertTask(list: TaskState[], task: TaskState): TaskState[] {
  const i = list.findIndex((t) => t.id === task.id)
  if (i < 0) return [...list, task]
  const next = list.slice()
  next[i] = task
  return next
}

function attachCurrentTask(agent: AgentState, tasks: TaskState[]): AgentState {
  return {
    ...agent,
    current_task: agent.current_task_id ? (tasks.find((t) => t.id === agent.current_task_id) ?? null) : null,
  }
}

let localTaskSeq = 9000

function resolveTaskId(tasks: TaskState[], agentId: string | null, rawId: unknown): string {
  if (typeof rawId === 'string' && rawId.length > 0) {
    if (/^T-\d+$/.test(rawId)) return rawId
    const existing = tasks.find((t) => t.agent_id === agentId && t.local_task_id === rawId)
    if (existing) return existing.id
  }
  localTaskSeq += 1
  return `T-${localTaskSeq}`
}

function applyEvent(e: AgentEvent): void {
  const p = e.payload
  let { agents, tasks, accounts, messages, dispatches, commands } = state

  const patchAgent = (id: string, fn: (a: AgentState) => AgentState) => {
    const a = agents.find((x) => x.id === id)
    if (!a) return
    agents = upsertAgent(agents, attachCurrentTask(fn(a), tasks))
  }
  const patchTask = (id: string, fn: (t: TaskState) => TaskState) => {
    const t = tasks.find((x) => x.id === id)
    if (!t) return
    tasks = upsertTask(tasks, fn(t))
  }
  const ensureAgent = (): AgentState | null => {
    if (!e.agent_id) return null
    let a = agents.find((x) => x.id === e.agent_id)
    if (!a) {
      a = {
        id: e.agent_id,
        name: e.agent_id,
        role: null,
        model: null,
        vendor: null,
        account_id: null,
        source: e.source,
        readonly: e.source === 'deepseek-otel',
        status: 'idle',
        current_task_id: null,
        tokens: 0,
        cost: 0,
        blocked_since: null,
        blocked_reason: null,
        last_event_ts: e.ts,
        created_at: e.ts,
        current_task: null,
      }
      agents = upsertAgent(agents, a)
    }
    return a
  }
  const ensureTask = (): TaskState | null => {
    const id = resolveTaskId(tasks, e.agent_id, p.task_id)
    let t = tasks.find((x) => x.id === id)
    if (!t) {
      t = {
        id,
        local_task_id: typeof p.task_id === 'string' && !/^T-\d+$/.test(p.task_id) ? p.task_id : null,
        agent_id: e.agent_id,
        from_agent: null,
        title: (p.title as string) ?? null,
        progress: 0,
        tokens: 0,
        cost: 0,
        estimated: false,
        status: 'running',
        started_at: e.ts,
        ended_at: null,
      }
      tasks = upsertTask(tasks, t)
    }
    return t
  }

  switch (e.type) {
    case 'agent.register': {
      const id = (p.agent_id as string) ?? e.agent_id
      if (!id) return
      const prev = agents.find((x) => x.id === id)
      const a: AgentState = {
        id,
        name: (p.name as string) ?? id,
        role: (p.role as string) ?? null,
        model: (p.model as string) ?? null,
        vendor: (p.vendor as string) ?? null,
        account_id: (p.account_id as string) ?? null,
        source: e.source,
        readonly: e.source === 'deepseek-otel',
        status: prev?.status ?? 'idle',
        current_task_id: prev?.current_task_id ?? null,
        tokens: prev?.tokens ?? 0,
        cost: prev?.cost ?? 0,
        blocked_since: null,
        blocked_reason: null,
        last_event_ts: e.ts,
        created_at: prev?.created_at ?? e.ts,
      }
      agents = upsertAgent(agents, attachCurrentTask(a, tasks))
      break
    }
    case 'task.start': {
      const t = ensureTask()
      if (!t) return
      patchTask(t.id, (x) => ({ ...x, status: 'running', started_at: x.started_at ?? e.ts, ended_at: null }))
      const a = ensureAgent()
      if (a) {
        patchAgent(a.id, (x) => ({
          ...x,
          status: 'running',
          current_task_id: t.id,
          blocked_since: null,
          blocked_reason: null,
        }))
      }
      break
    }
    case 'task.progress': {
      const t = ensureTask()
      if (!t) return
      patchTask(t.id, (x) => ({
        ...x,
        progress: typeof p.progress === 'number' ? p.progress : x.progress,
        tokens: typeof p.tokens === 'number' ? p.tokens : x.tokens,
        cost: typeof p.cost === 'number' ? p.cost : x.cost,
        estimated: p.estimated === true ? true : x.estimated,
      }))
      if (t.agent_id) {
        const nt = tasks.find((x) => x.id === t.id)
        if (nt) {
          patchAgent(t.agent_id, (x) => ({
            ...x,
            tokens: Math.max(x.tokens, nt.tokens),
            cost: Math.max(x.cost, nt.cost),
          }))
        }
      }
      break
    }
    case 'task.done':
    case 'task.error': {
      const t = ensureTask()
      if (!t) return
      const done = e.type === 'task.done'
      patchTask(t.id, (x) => ({
        ...x,
        status: done ? 'done' : 'error',
        ended_at: e.ts,
        progress: done ? 100 : x.progress,
      }))
      const agentId = t.agent_id ?? e.agent_id
      if (agentId) {
        patchAgent(agentId, (x) =>
          x.current_task_id === t.id ? { ...x, current_task_id: null, status: 'idle' } : x,
        )
      }
      break
    }
    case 'task.dispatch': {
      const toAgent = (p.to_agent as string) ?? e.agent_id
      const id = resolveTaskId(tasks, toAgent, p.task_id)
      const prev = tasks.find((x) => x.id === id)
      const t: TaskState = prev
        ? { ...prev, agent_id: toAgent, from_agent: (p.from_agent as string) ?? prev.from_agent }
        : {
            id,
            local_task_id: typeof p.task_id === 'string' && !/^T-\d+$/.test(p.task_id) ? p.task_id : null,
            agent_id: toAgent,
            from_agent: (p.from_agent as string) ?? null,
            title: (p.title as string) ?? null,
            progress: 0,
            tokens: 0,
            cost: 0,
            estimated: false,
            status: 'running',
            started_at: e.ts,
            ended_at: null,
          }
      tasks = upsertTask(tasks, t)
      dispatches = [...dispatches, { from_agent: t.from_agent, to_agent: toAgent, task_id: id, ts: e.ts }].slice(-200)
      break
    }
    case 'agent.blocked': {
      const a = ensureAgent()
      if (!a) return
      patchAgent(a.id, (x) => ({
        ...x,
        status: 'blocked',
        blocked_since: e.ts,
        blocked_reason: (p.reason as string) ?? null,
      }))
      break
    }
    case 'agent.resumed': {
      const a = ensureAgent()
      if (!a) return
      patchAgent(a.id, (x) => ({
        ...x,
        status: x.current_task_id ? 'running' : 'idle',
        blocked_since: null,
        blocked_reason: null,
      }))
      break
    }
    case 'approval.request': {
      const a = ensureAgent()
      if (!a) return
      patchAgent(a.id, (x) => ({ ...x, status: 'waiting' }))
      break
    }
    case 'message.send': {
      messages = [
        ...messages,
        {
          ts: e.ts,
          from: (p.from as string) ?? null,
          to: (p.to as string) ?? null,
          kind: (p.kind as string) ?? '系统',
          text: (p.text as string) ?? '',
        },
      ].slice(-200)
      break
    }
    case 'quota.snapshot': {
      const accountId = p.account_id as string | undefined
      if (!accountId) return
      const acc = accounts.find((x) => x.id === accountId)
      if (!acc) return
      const next: AccountState = { ...acc, demo: p.demo === true, updated_at: e.ts }
      if (p.quota_kind === 'balance') {
        next.balance_cny = (p.balance_cny as number) ?? null
        next.balance_detail = (p.balance_detail as AccountState['balance_detail']) ?? null
        next.balance_rate_per_h = (p.rate_per_h as number | null) ?? null
      } else if (Array.isArray(p.windows)) {
        next.windows = (
          p.windows as { label: string; remaining_pct: number; resets_at: string | null; rate_per_h?: number | null }[]
        ).map((w) => ({
          label: w.label,
          remaining_pct: w.remaining_pct,
          resets_at: w.resets_at ?? null,
          rate_per_h: w.rate_per_h ?? null,
        }))
      }
      accounts = accounts.map((x) => (x.id === accountId ? next : x))
      break
    }
    case 'command.reply': {
      // 回复经 WS 实时到达（FR-8）；command.send 不回放（本地已在 POST 时入账）
      if (state.mode === 'live' && wsConnected) {
        const target = (p.target as string) ?? 'commander'
        commands = [
          ...commands,
          {
            id: e.id,
            ts: e.ts,
            target,
            direction: 'out',
            text: (p.text as string) ?? '',
            cost_tokens: typeof p.tokens === 'number' ? p.tokens : 0,
          },
        ]
      }
      break
    }
    default:
      return // command.send / dag.* 不进当前态
  }

  if (e.agent_id) {
    patchAgent(e.agent_id, (x) => ({ ...x, last_event_ts: e.ts }))
  }
  setState({ agents, tasks, accounts, messages, dispatches, commands })
}

function applySnapshot(s: StateSnapshot): void {
  setState({
    ts: s.ts,
    agents: s.agents.map((a) => ({ ...a, current_task: a.current_task ?? null })),
    tasks: s.tasks,
    accounts: s.accounts,
    alerts: s.alerts,
    messages: s.messages,
    dispatches: s.dispatches,
    commander: s.commander ?? null,
  })
}

// ---------- 连接编排（live / demo 降级） ----------

let started = false
let wsConnected = false
let stream: StreamClient | null = null
let demoTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let demoFeedIdx = 0

async function connectLive(): Promise<boolean> {
  try {
    const snap = await fetchState()
    applySnapshot(snap)
    setState({ mode: 'live' })
    stopDemo()
    startStream()
    void loadCommandHistory()
    return true
  } catch {
    return false
  }
}

function startStream(): void {
  if (stream) return
  stream = new StreamClient({
    onMessage: (msg: StreamMessage) => {
      if (msg.type === 'event') applyEvent(msg.data)
      else if (msg.type === 'alerts') setState({ alerts: msg.data })
    },
    onOpen: () => {
      wsConnected = true
      // 重连后全量对齐（§8.1-A4）
      void fetchState()
        .then(applySnapshot)
        .catch(() => undefined)
    },
    onClose: () => {
      wsConnected = false
    },
  })
  stream.start()
}

function stopStream(): void {
  stream?.stop()
  stream = null
  wsConnected = false
}

// ---------- 演示模式 ----------

function enterDemo(): void {
  const tasks = demoTasks()
  const agents = demoAgents(tasks)
  const accounts = demoAccounts()
  setState({
    mode: 'demo',
    ts: nowIsoLocal(),
    agents,
    tasks,
    accounts,
    messages: demoMessages(),
    dispatches: demoDispatches(),
    alerts: deriveDemoAlerts(accounts, agents, Date.now()),
    commander: { backend: 'demo', degraded: true },
    commands: [],
  })
  startDemo()
}

function startDemo(): void {
  if (demoTimer) return
  let tick = 0
  demoTimer = setInterval(() => {
    tick += 1
    const now = Date.now()
    let { agents, tasks, accounts, messages } = state
    // token / 成本走动（仅执行中的演示 agent）
    agents = agents.map((a) => {
      if (a.status !== 'running') return a
      const add = Math.floor(18 + Math.random() * 55)
      return { ...a, tokens: a.tokens + add, cost: Math.round((a.cost + 0.001) * 1000) / 1000 }
    })
    tasks = tasks.map((t) => {
      if (t.status !== 'running') return t
      const a = agents.find((x) => x.id === t.agent_id)
      return a && a.current_task_id === t.id ? { ...t, tokens: a.tokens, cost: a.cost } : t
    })
    // 配额缓慢消耗
    if (tick % 30 === 0) {
      accounts = accounts.map((acc) => {
        if (acc.quota_kind === 'balance' && acc.balance_cny !== null) {
          const b = Math.max(0, Math.round((acc.balance_cny - 0.02) * 100) / 100)
          return {
            ...acc,
            balance_cny: b,
            balance_detail: acc.balance_detail ? { ...acc.balance_detail, total: b } : null,
          }
        }
        return {
          ...acc,
          windows: acc.windows.map((w, i) =>
            i === 0 ? { ...w, remaining_pct: Math.max(3, Math.round((w.remaining_pct - 0.05) * 10) / 10) } : w,
          ),
        }
      })
    }
    // 偶发通信流消息
    if (tick % 12 === 0) {
      const line = DEMO_FEED_LINES[demoFeedIdx % DEMO_FEED_LINES.length]
      demoFeedIdx += 1
      messages = [...messages, { ...line, ts: nowIsoLocal() }].slice(-200)
    }
    setState({
      agents,
      tasks,
      accounts,
      messages,
      ts: nowIsoLocal(),
      alerts: deriveDemoAlerts(accounts, agents, now),
    })
  }, 1000)
}

function stopDemo(): void {
  if (demoTimer) clearInterval(demoTimer)
  demoTimer = null
}

/** 入口：首屏尝试连后端，失败降级演示模式并后台重试。 */
export function initApp(): void {
  if (started) return
  started = true
  void (async () => {
    const ok = await connectLive()
    if (!ok) {
      enterDemo()
      scheduleLiveRetry()
    }
  })()
}

function scheduleLiveRetry(): void {
  if (retryTimer) return
  retryTimer = setTimeout(async () => {
    retryTimer = null
    if (state.mode === 'live') return
    const ok = await connectLive()
    if (!ok) scheduleLiveRetry()
  }, 15_000)
}

// ---------- 指挥台（FR-8） ----------

export async function loadCommandHistory(): Promise<void> {
  try {
    const history = await fetchCommandHistory(50)
    setState({ commands: history })
  } catch {
    /* 历史加载失败保留现状 */
  }
}

export function openCommander(agentId?: string): void {
  const patch: Partial<AppState> = { commanderOpen: true }
  if (agentId) {
    patch.commanderThread = agentId
    patch.commanderPrefill = `@${agentId} `
    patch.commanderPrefillSeq = state.commanderPrefillSeq + 1
  }
  setState(patch)
}

export function closeCommander(): void {
  setState({ commanderOpen: false })
}

export function setCommanderThread(target: string): void {
  setState({ commanderThread: target })
}

const AT_RE = /^@([\w-]+)\s*([\s\S]*)$/

function resolveTarget(text: string, fallback: string): string {
  const at = AT_RE.exec(text.trim())
  if (at) return at[1]
  return fallback !== 'commander' ? fallback : 'commander'
}

function patchCommand(id: string, patch: Partial<UiCommand>): void {
  setState({
    commands: state.commands.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  })
}

let localCmdSeq = 0

export async function sendCommand(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  const target = resolveTarget(trimmed, state.commanderThread)
  localCmdSeq += 1
  const id = `local-${Date.now()}-${localCmdSeq}`
  const rec: UiCommand = { id, ts: nowIsoLocal(), target, direction: 'in', text: trimmed, cost_tokens: 0, pending: true }
  setState({ commands: [...state.commands, rec], commanderThread: target })

  if (state.mode === 'demo') {
    patchCommand(id, { pending: false })
    simulateDemoReply(target, trimmed)
    return
  }

  try {
    const result = await postCommand(target, trimmed)
    patchCommand(id, { pending: false })
    // WS 未连接时直接用 HTTP 响应补录回复，避免丢消息
    if (!wsConnected && result.reply) {
      setState({
        commands: [
          ...state.commands,
          { id: `${id}-reply`, ts: nowIsoLocal(), target: result.target, direction: 'out', text: result.reply, cost_tokens: 0 },
        ],
      })
    }
  } catch {
    patchCommand(id, { pending: false, failed: true })
  }
}

export async function retryCommand(id: string): Promise<void> {
  const rec = state.commands.find((c) => c.id === id)
  if (!rec || rec.direction !== 'in') return
  patchCommand(id, { pending: true, failed: false })
  try {
    await postCommand(rec.target, rec.text)
    patchCommand(id, { pending: false })
  } catch {
    patchCommand(id, { pending: false, failed: true })
  }
}

function simulateDemoReply(target: string, text: string): void {
  const agent = state.agents.find((a) => a.id === target || a.name === target)
  let reply: string
  if (target === 'commander') {
    reply =
      '【指挥 agent · 演示模式】后端未接入，当前为本地模拟回复。' +
      `已收到：「${text.slice(0, 80)}」。接入后端后可结合实时状态（agent/配额/告警）给出回应。`
  } else if (!agent) {
    reply = `未找到名为 ${target} 的 agent，无法转发。（演示模式模拟）`
  } else if (agent.readonly) {
    reply = `该 agent（${agent.name}，来源 ${agent.source}）只读，无法对话。（演示模式模拟）`
  } else {
    reply = `【${agent.name} · 演示转发】已收到指令：「${text.slice(0, 80)}」。后端接入后走 CLI 非交互会话真实转发。`
  }
  setTimeout(() => {
    localCmdSeq += 1
    setState({
      commands: [
        ...state.commands,
        {
          id: `demo-${Date.now()}-${localCmdSeq}`,
          ts: nowIsoLocal(),
          target,
          direction: 'out',
          text: reply,
          cost_tokens: 0,
        },
      ],
    })
  }, 600)
}

// ---------- Agent 控制（§7.4） ----------

export async function agentAction(id: string, action: 'pause' | 'resume' | 'approve' | 'reject'): Promise<string | null> {
  if (state.mode === 'demo') {
    // 演示模式本地模拟
    const agents = state.agents.map((a) => {
      if (a.id !== id || a.readonly) return a
      if (action === 'pause' && a.status === 'running') return { ...a, status: 'idle' as const }
      if (action === 'resume' && (a.status === 'idle' || a.status === 'blocked')) {
        return { ...a, status: (a.current_task_id ? 'running' : 'idle') as AgentState['status'], blocked_since: null, blocked_reason: null }
      }
      if (action === 'approve' && a.status === 'waiting') return { ...a, status: 'running' as const }
      if (action === 'reject' && a.status === 'waiting') return { ...a, status: 'done' as const, current_task_id: null }
      return a
    })
    setState({ agents, alerts: deriveDemoAlerts(state.accounts, agents, Date.now()) })
    return null
  }
  try {
    const res = await postAgentAction(id, action)
    return res.readonly ? (res.message ?? '该来源只读') : null
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

/** 测试/调试用：彻底复位（不用于生产路径）。 */
export function _resetForTests(): void {
  stopStream()
  stopDemo()
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  started = false
  state = EMPTY
}
