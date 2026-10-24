import type { AgentEvent, SourceName } from './events.js';
import { nowIso } from './events.js';
import type { Db, QuotaSnapshotRow } from '../db/index.js';

/**
 * §8.1-A3 内存物化视图：agents / tasks / accounts / alerts 当前态。
 * events 表是唯一事实源；启动时按重建规则重放：
 * 仅 agent.* / task.* / dag.* / approval.* 参与重放；quota.snapshot 只取最新一条。
 */

export type AgentStatus = 'running' | 'waiting' | 'blocked' | 'idle' | 'done' | 'error';

export interface AgentState {
  id: string;
  name: string;
  role: string | null;
  model: string | null;
  vendor: string | null;
  account_id: string | null;
  source: SourceName;
  readonly: boolean;
  status: AgentStatus;
  current_task_id: string | null;
  tokens: number;
  cost: number;
  blocked_since: string | null;
  blocked_reason: string | null;
  last_event_ts: string;
  created_at: string;
}

export interface TaskState {
  id: string;
  local_task_id: string | null;
  agent_id: string | null;
  from_agent: string | null;
  title: string | null;
  progress: number;
  tokens: number;
  cost: number;
  estimated: boolean;
  status: 'running' | 'done' | 'error';
  started_at: string | null;
  ended_at: string | null;
}

export interface QuotaWindow {
  label: string;
  remaining_pct: number;
  resets_at: string | null;
  rate_per_h: number | null;
}

export interface AccountState {
  id: string;
  name: string;
  plan: string | null;
  quota_kind: 'balance' | 'window';
  demo: boolean;
  balance_cny: number | null;
  balance_detail: { total: number; granted: number; topped_up: number } | null;
  balance_rate_per_h: number | null;
  windows: QuotaWindow[];
  updated_at: string | null;
}

export interface Alert {
  key: string;
  level: 'CRIT' | 'WARN' | 'OK' | 'INFO';
  title: string;
  message: string;
  ts: string;
  ephemeral: boolean;
}

export interface DispatchEdge {
  from_agent: string | null;
  to_agent: string | null;
  task_id: string;
  ts: string;
}

export interface FeedMessage {
  ts: string;
  from: string | null;
  to: string | null;
  kind: string;
  text: string;
}

function toAgentRow(a: AgentState) {
  return {
    id: a.id,
    name: a.name,
    role: a.role,
    model: a.model,
    vendor: a.vendor,
    account_id: a.account_id,
    status: a.status,
    created_at: a.created_at,
  };
}

function toTaskRow(t: TaskState) {
  return {
    id: t.id,
    local_task_id: t.local_task_id,
    agent_id: t.agent_id,
    title: t.title,
    progress: t.progress,
    tokens: t.tokens,
    cost: t.cost,
    status: t.status,
    started_at: t.started_at,
    ended_at: t.ended_at,
  };
}

export class Aggregate {
  readonly agents = new Map<string, AgentState>();
  readonly tasks = new Map<string, TaskState>();
  readonly accounts = new Map<string, AccountState>();
  readonly alerts = new Map<string, Alert>();
  readonly dispatches: DispatchEdge[] = [];
  readonly messages: FeedMessage[] = [];
  /** `${agent_id}:${local_task_id}` → 全局任务 ID */
  private localTaskMap = new Map<string, string>();

  constructor(private db: Db) {
    for (const a of db.listAccounts()) {
      this.accounts.set(a.id, {
        id: a.id,
        name: a.name,
        plan: a.plan,
        quota_kind: a.quota_kind as 'balance' | 'window',
        demo: false,
        balance_cny: null,
        balance_detail: null,
        balance_rate_per_h: null,
        windows: [],
        updated_at: null,
      });
    }
    for (const t of db.loadTaskLocalIds()) {
      if (t.local_task_id && t.agent_id) {
        this.localTaskMap.set(`${t.agent_id}:${t.local_task_id}`, t.id);
      }
    }
  }

  // ---------- 重放 ----------

  replay(): void {
    const events = this.db.loadLifecycleEvents();
    for (const e of events) this.apply(e, false);
    for (const row of this.db.latestQuotaSnapshots()) this.applyQuotaRow(row);
  }

  private applyQuotaRow(row: QuotaSnapshotRow): void {
    const acc = this.accounts.get(row.account_id);
    if (!acc) return;
    if (row.window_label === null) {
      acc.balance_cny = row.balance_cny;
    } else {
      const w = acc.windows.find((x) => x.label === row.window_label);
      if (w) {
        w.remaining_pct = row.remaining_pct ?? w.remaining_pct;
        w.resets_at = row.resets_at;
      } else {
        acc.windows.push({
          label: row.window_label,
          remaining_pct: row.remaining_pct ?? 0,
          resets_at: row.resets_at,
          rate_per_h: null,
        });
      }
    }
    acc.updated_at = row.captured_at;
  }

  // ---------- 事件应用 ----------

  apply(e: AgentEvent, persist = true): void {
    switch (e.type) {
      case 'agent.register':
        this.onAgentRegister(e);
        break;
      case 'task.start':
        this.onTaskStart(e);
        break;
      case 'task.progress':
        this.onTaskProgress(e);
        break;
      case 'task.done':
      case 'task.error':
        this.onTaskEnd(e);
        break;
      case 'task.dispatch':
        this.onTaskDispatch(e);
        break;
      case 'agent.blocked':
        this.onAgentBlocked(e);
        break;
      case 'agent.resumed':
        this.onAgentResumed(e);
        break;
      case 'approval.request':
        this.onApprovalRequest(e);
        break;
      case 'message.send':
        this.onMessage(e);
        break;
      case 'quota.snapshot':
        this.onQuotaSnapshot(e);
        break;
      default:
        break; // command.* / dag.* 不进当前态（dag 预览态留给 M3）
    }
    if (e.agent_id) {
      const a = this.agents.get(e.agent_id);
      if (a) a.last_event_ts = e.ts;
    }
    void persist;
  }

  private ensureAgent(e: AgentEvent): AgentState | null {
    if (!e.agent_id) return null;
    let a = this.agents.get(e.agent_id);
    if (!a) {
      // 未知 agent 自动登记（hook 直发 task.* 而未先 register 的情况）
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
      };
      this.agents.set(a.id, a);
      this.db.upsertAgent(toAgentRow(a));
    }
    return a;
  }

  /** 来源侧本地任务标识 → 全局 T-xxxx；不存在则发号新建映射。 */
  resolveTaskId(agentId: string | null, rawId: unknown): string {
    if (typeof rawId !== 'string' || rawId.length === 0) return this.db.nextTaskId();
    if (/^T-\d+$/.test(rawId)) return rawId;
    const key = `${agentId ?? ''}:${rawId}`;
    const existing = this.localTaskMap.get(key);
    if (existing) return existing;
    const id = this.db.nextTaskId();
    this.localTaskMap.set(key, id);
    return id;
  }

  private onAgentRegister(e: AgentEvent): void {
    const p = e.payload;
    const id = (p.agent_id as string) ?? e.agent_id;
    if (!id) return;
    const prev = this.agents.get(id);
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
    };
    this.agents.set(id, a);
    this.db.upsertAgent(toAgentRow(a));
  }

  private ensureTask(e: AgentEvent, title?: string | null): TaskState | null {
    const rawId = e.payload.task_id;
    const id = this.resolveTaskId(e.agent_id, rawId);
    let t = this.tasks.get(id);
    if (!t) {
      t = {
        id,
        local_task_id: typeof rawId === 'string' && !/^T-\d+$/.test(rawId) ? rawId : null,
        agent_id: e.agent_id,
        from_agent: null,
        title: title ?? (e.payload.title as string) ?? null,
        progress: 0,
        tokens: 0,
        cost: 0,
        estimated: false,
        status: 'running',
        started_at: e.ts,
        ended_at: null,
      };
      this.tasks.set(id, t);
    }
    return t;
  }

  private onTaskStart(e: AgentEvent): void {
    const t = this.ensureTask(e);
    if (!t) return;
    t.status = 'running';
    t.started_at = t.started_at ?? e.ts;
    t.ended_at = null;
    this.db.upsertTask(toTaskRow(t));
    const a = this.ensureAgent(e);
    if (a) {
      a.status = 'running';
      a.current_task_id = t.id;
      a.blocked_since = null;
      a.blocked_reason = null;
      this.db.upsertAgent(toAgentRow(a));
    }
  }

  private onTaskProgress(e: AgentEvent): void {
    const t = this.ensureTask(e);
    if (!t) return;
    const p = e.payload;
    if (typeof p.progress === 'number') t.progress = p.progress;
    if (typeof p.tokens === 'number') t.tokens = p.tokens;
    if (typeof p.cost === 'number') t.cost = p.cost;
    if (p.estimated === true) t.estimated = true;
    this.db.upsertTask(toTaskRow(t));
    const a = this.agents.get(t.agent_id ?? '');
    if (a) {
      a.tokens = Math.max(a.tokens, t.tokens);
      a.cost = Math.max(a.cost, t.cost);
    }
  }

  private onTaskEnd(e: AgentEvent): void {
    const t = this.ensureTask(e);
    if (!t) return;
    t.status = e.type === 'task.done' ? 'done' : 'error';
    t.ended_at = e.ts;
    if (e.type === 'task.done') t.progress = 100;
    this.db.upsertTask(toTaskRow(t));
    const a = this.agents.get(t.agent_id ?? e.agent_id ?? '');
    if (a && a.current_task_id === t.id) {
      a.current_task_id = null;
      a.status = 'idle';
      this.db.upsertAgent(toAgentRow(a));
    }
  }

  private onTaskDispatch(e: AgentEvent): void {
    const p = e.payload;
    const toAgent = (p.to_agent as string) ?? e.agent_id;
    const id = this.resolveTaskId(toAgent, p.task_id);
    let t = this.tasks.get(id);
    if (!t) {
      t = {
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
      };
      this.tasks.set(id, t);
    } else {
      t.agent_id = toAgent;
      t.from_agent = (p.from_agent as string) ?? t.from_agent;
    }
    this.db.upsertTask(toTaskRow(t));
    this.dispatches.push({ from_agent: t.from_agent, to_agent: toAgent, task_id: id, ts: e.ts });
  }

  private onAgentBlocked(e: AgentEvent): void {
    const a = this.ensureAgent(e);
    if (!a) return;
    a.status = 'blocked';
    a.blocked_since = e.ts;
    a.blocked_reason = (e.payload.reason as string) ?? null;
    this.db.upsertAgent(toAgentRow(a));
  }

  private onAgentResumed(e: AgentEvent): void {
    const a = this.ensureAgent(e);
    if (!a) return;
    a.status = a.current_task_id ? 'running' : 'idle';
    a.blocked_since = null;
    a.blocked_reason = null;
    this.db.upsertAgent(toAgentRow(a));
  }

  private onApprovalRequest(e: AgentEvent): void {
    const a = this.ensureAgent(e);
    if (!a) return;
    a.status = 'waiting';
    this.db.upsertAgent(toAgentRow(a));
  }

  private onMessage(e: AgentEvent): void {
    const p = e.payload;
    this.messages.push({
      ts: e.ts,
      from: (p.from as string) ?? null,
      to: (p.to as string) ?? null,
      kind: (p.kind as string) ?? '系统',
      text: (p.text as string) ?? '',
    });
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
  }

  private onQuotaSnapshot(e: AgentEvent): void {
    const p = e.payload as {
      account_id?: string;
      quota_kind?: string;
      demo?: boolean;
      balance_cny?: number;
      balance_detail?: { total: number; granted: number; topped_up: number };
      windows?: { label: string; remaining_pct: number; resets_at: string | null; rate_per_h?: number | null }[];
      rate_per_h?: number | null;
    };
    if (!p.account_id) return;
    const acc = this.accounts.get(p.account_id);
    if (!acc) return;
    acc.demo = p.demo === true;
    acc.updated_at = e.ts;
    if (p.quota_kind === 'balance') {
      acc.balance_cny = p.balance_cny ?? null;
      acc.balance_detail = p.balance_detail ?? null;
      acc.balance_rate_per_h = p.rate_per_h ?? null;
    } else if (Array.isArray(p.windows)) {
      acc.windows = p.windows.map((w) => ({
        label: w.label,
        remaining_pct: w.remaining_pct,
        resets_at: w.resets_at ?? null,
        rate_per_h: w.rate_per_h ?? null,
      }));
    }
  }

  // ---------- 快照输出 ----------

  snapshot() {
    return {
      ts: nowIso(),
      agents: [...this.agents.values()].map((a) => ({
        ...a,
        current_task: a.current_task_id ? this.tasks.get(a.current_task_id) ?? null : null,
      })),
      tasks: [...this.tasks.values()],
      accounts: [...this.accounts.values()],
      alerts: [...this.alerts.values()],
      messages: this.messages.slice(-100),
      dispatches: this.dispatches.slice(-200),
    };
  }
}
