import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { AgentEvent } from '../core/events.js';
import { isLifecycleEvent, nowIso } from '../core/events.js';

/**
 * §9 数据模型 + 全局任务 ID 发号器（T-xxxx 自增，meta 表持久化序号）。
 * M1 表：agents / tasks / events / accounts / quota_snapshots
 * M2 表：commands；dag_proposals 一并建好留给 M3。
 */

export interface QuotaSnapshotRow {
  id: number;
  account_id: string;
  window_label: string | null;
  remaining_pct: number | null;
  balance_cny: number | null;
  resets_at: string | null;
  captured_at: string;
}

export interface CommandRow {
  id: string;
  ts: string;
  target: string;
  direction: 'in' | 'out';
  text: string;
  cost_tokens: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT, model TEXT, vendor TEXT,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  local_task_id TEXT,
  agent_id TEXT REFERENCES agents(id),
  title TEXT, progress INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0, cost REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT, ended_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT, agent_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT, plan TEXT,
  quota_kind TEXT NOT NULL,
  window_label TEXT
);

CREATE TABLE IF NOT EXISTS quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  window_label TEXT,
  remaining_pct REAL,
  balance_cny REAL,
  resets_at TEXT,
  captured_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quota ON quota_snapshots(account_id, captured_at);

CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  target TEXT NOT NULL,
  direction TEXT NOT NULL,
  text TEXT NOT NULL,
  cost_tokens INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS dag_proposals (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  spec TEXT NOT NULL,
  feedback TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const DEFAULT_ACCOUNTS = [
  { id: 'deepseek', name: 'DeepSeek API', plan: '按量计费', quota_kind: 'balance', window_label: null },
  { id: 'kimi', name: 'Kimi Code · 会员 · 主号', plan: '会员', quota_kind: 'window', window_label: null },
  { id: 'codex', name: 'ChatGPT/Codex · Plus', plan: 'Plus', quota_kind: 'window', window_label: null },
] as const;

export class Db {
  private db: Database.Database;

  constructor(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.seedAccounts();
    this.initTaskSeq();
  }

  private seedAccounts(): void {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO accounts (id, name, plan, quota_kind, window_label) VALUES (?, ?, ?, ?, ?)',
    );
    for (const a of DEFAULT_ACCOUNTS) {
      stmt.run(a.id, a.name, a.plan, a.quota_kind, a.window_label);
    }
  }

  listAccounts(): { id: string; name: string; plan: string | null; quota_kind: string; window_label: string | null }[] {
    return this.db
      .prepare('SELECT id, name, plan, quota_kind, window_label FROM accounts')
      .all() as { id: string; name: string; plan: string | null; quota_kind: string; window_label: string | null }[];
  }

  // ---------- 事件流水 ----------

  insertEvent(e: AgentEvent): void {
    this.db
      .prepare('INSERT OR IGNORE INTO events (id, ts, source, agent_id, type, payload) VALUES (?, ?, ?, ?, ?, ?)')
      .run(e.id, e.ts, e.source, e.agent_id, e.type, JSON.stringify(e.payload));
  }

  /** §8.1-A3：启动重放只取生命周期事件，按时间升序。 */
  loadLifecycleEvents(): AgentEvent[] {
    const rows = this.db.prepare('SELECT id, ts, source, agent_id, type, payload FROM events ORDER BY ts ASC').all() as {
      id: string; ts: string; source: string; agent_id: string | null; type: string; payload: string;
    }[];
    return rows
      .filter((r) => isLifecycleEvent(r.type as AgentEvent['type']))
      .map((r) => ({
        id: r.id,
        ts: r.ts,
        source: r.source as AgentEvent['source'],
        agent_id: r.agent_id,
        type: r.type as AgentEvent['type'],
        payload: JSON.parse(r.payload) as Record<string, unknown>,
      }));
  }

  // ---------- agents / tasks 物化 ----------

  upsertAgent(a: {
    id: string; name: string; role?: string | null; model?: string | null;
    vendor?: string | null; account_id?: string | null; status: string; created_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO agents (id, name, role, model, vendor, account_id, status, created_at)
         VALUES (@id, @name, @role, @model, @vendor, @account_id, @status, @created_at)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, role=excluded.role, model=excluded.model,
           vendor=excluded.vendor, account_id=excluded.account_id, status=excluded.status`,
      )
      .run({
        id: a.id,
        name: a.name,
        role: a.role ?? null,
        model: a.model ?? null,
        vendor: a.vendor ?? null,
        account_id: a.account_id ?? null,
        status: a.status,
        created_at: a.created_at,
      });
  }

  upsertTask(t: {
    id: string; local_task_id?: string | null; agent_id?: string | null; title?: string | null;
    progress?: number; tokens?: number; cost?: number; status: string;
    started_at?: string | null; ended_at?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO tasks (id, local_task_id, agent_id, title, progress, tokens, cost, status, started_at, ended_at)
         VALUES (@id, @local_task_id, @agent_id, @title, @progress, @tokens, @cost, @status, @started_at, @ended_at)
         ON CONFLICT(id) DO UPDATE SET
           local_task_id=excluded.local_task_id, agent_id=excluded.agent_id, title=excluded.title,
           progress=excluded.progress, tokens=excluded.tokens, cost=excluded.cost,
           status=excluded.status, started_at=excluded.started_at, ended_at=excluded.ended_at`,
      )
      .run({
        id: t.id,
        local_task_id: t.local_task_id ?? null,
        agent_id: t.agent_id ?? null,
        title: t.title ?? null,
        progress: t.progress ?? 0,
        tokens: t.tokens ?? 0,
        cost: t.cost ?? 0,
        status: t.status,
        started_at: t.started_at ?? null,
        ended_at: t.ended_at ?? null,
      });
  }

  loadTaskLocalIds(): { id: string; local_task_id: string | null; agent_id: string | null }[] {
    return this.db.prepare('SELECT id, local_task_id, agent_id FROM tasks').all() as {
      id: string; local_task_id: string | null; agent_id: string | null;
    }[];
  }

  // ---------- 全局任务 ID 发号器 ----------

  private initTaskSeq(): void {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'task_seq'").get() as { value: string } | undefined;
    if (!row) {
      // 从既有任务 ID 推导最大值，保证重放/升级后续号
      const ids = this.db.prepare('SELECT id FROM tasks').all() as { id: string }[];
      let max = 0;
      for (const { id } of ids) {
        const m = /^T-(\d+)$/.exec(id);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      this.db.prepare("INSERT INTO meta (key, value) VALUES ('task_seq', ?)").run(String(max));
    }
  }

  nextTaskId(): string {
    const tx = this.db.transaction(() => {
      const row = this.db.prepare("SELECT value FROM meta WHERE key = 'task_seq'").get() as { value: string };
      const next = parseInt(row.value, 10) + 1;
      this.db.prepare("UPDATE meta SET value = ? WHERE key = 'task_seq'").run(String(next));
      return next;
    });
    return `T-${String(tx()).padStart(4, '0')}`;
  }

  // ---------- 配额快照 ----------

  insertQuotaSnapshots(e: AgentEvent): void {
    const p = e.payload as {
      account_id?: string;
      quota_kind?: string;
      balance_cny?: number;
      windows?: { label: string; remaining_pct: number; resets_at: string | null }[];
    };
    if (!p.account_id) return;
    const stmt = this.db.prepare(
      `INSERT INTO quota_snapshots (account_id, window_label, remaining_pct, balance_cny, resets_at, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    if (p.quota_kind === 'balance') {
      stmt.run(p.account_id, null, null, p.balance_cny ?? null, null, e.ts);
    } else if (Array.isArray(p.windows)) {
      for (const w of p.windows) {
        stmt.run(p.account_id, w.label, w.remaining_pct, null, w.resets_at ?? null, e.ts);
      }
    }
  }

  /** 每账号+窗口最新一条快照（quota.snapshot 重放只取最新，§8.1-A3）。 */
  latestQuotaSnapshots(): QuotaSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT q.* FROM quota_snapshots q
         JOIN (
           SELECT account_id, IFNULL(window_label, '') AS wl, MAX(captured_at) AS mx
           FROM quota_snapshots GROUP BY account_id, IFNULL(window_label, '')
         ) latest
         ON q.account_id = latest.account_id
         AND IFNULL(q.window_label, '') = latest.wl
         AND q.captured_at = latest.mx`,
      )
      .all() as QuotaSnapshotRow[];
  }

  quotaHistory(accountId: string, sinceIso: string): QuotaSnapshotRow[] {
    return this.db
      .prepare(
        'SELECT * FROM quota_snapshots WHERE account_id = ? AND captured_at >= ? ORDER BY captured_at ASC',
      )
      .all(accountId, sinceIso) as QuotaSnapshotRow[];
  }

  /** 近 1h 最小二乘取数点 */
  quotaPoints(accountId: string, windowLabel: string | null, sinceIso: string): { t: number; y: number }[] {
    const rows = (
      windowLabel === null
        ? this.db.prepare(
            'SELECT captured_at, balance_cny AS v FROM quota_snapshots WHERE account_id = ? AND window_label IS NULL AND captured_at >= ? ORDER BY captured_at ASC',
          ).all(accountId, sinceIso)
        : this.db.prepare(
            'SELECT captured_at, remaining_pct AS v FROM quota_snapshots WHERE account_id = ? AND window_label = ? AND captured_at >= ? ORDER BY captured_at ASC',
          ).all(accountId, windowLabel, sinceIso)
    ) as { captured_at: string; v: number | null }[];
    return rows
      .filter((r) => r.v !== null)
      .map((r) => ({ t: new Date(r.captured_at).getTime(), y: r.v as number }));
  }

  // ---------- 指挥台对话 ----------

  insertCommand(row: CommandRow): void {
    this.db
      .prepare('INSERT INTO commands (id, ts, target, direction, text, cost_tokens) VALUES (?, ?, ?, ?, ?, ?)')
      .run(row.id, row.ts, row.target, row.direction, row.text, row.cost_tokens);
  }

  commandHistory(limit: number): CommandRow[] {
    const rows = this.db
      .prepare('SELECT * FROM commands ORDER BY ts DESC, id DESC LIMIT ?')
      .all(limit) as CommandRow[];
    return rows.reverse();
  }

  now(): string {
    return nowIso();
  }

  close(): void {
    this.db.close();
  }
}
