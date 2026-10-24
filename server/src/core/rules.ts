import type { AgentEvent, EventBus } from './events.js';
import { nowIso } from './events.js';
import type { Aggregate, Alert } from './aggregate.js';

/**
 * §FR-6 规则引擎（M2）：配置化阈值、告警去重与自动恢复。
 * - 账号窗口配额 ≤15% → CRIT；≤40% → WARN
 * - agent blocked 超过 blockedWarnMin 分钟 → WARN
 * - agent 进入 waiting（等待审批）→ WARN
 * - 任务完成 → OK（短暂展示后自动消失）
 * - 窗口配额即将重置（<resetInfoMin 分钟）→ INFO
 *
 * 阈值可用环境变量覆盖：AGENTOPS_RULE_QUOTA_CRIT / _WARN / _BLOCKED_MIN / _RESET_MIN
 */

export interface RuleThresholds {
  quotaCritPct: number;
  quotaWarnPct: number;
  blockedWarnMin: number;
  resetInfoMin: number;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function defaultThresholds(): RuleThresholds {
  return {
    quotaCritPct: envNum('AGENTOPS_RULE_QUOTA_CRIT', 15),
    quotaWarnPct: envNum('AGENTOPS_RULE_QUOTA_WARN', 40),
    blockedWarnMin: envNum('AGENTOPS_RULE_BLOCKED_MIN', 10),
    resetInfoMin: envNum('AGENTOPS_RULE_RESET_MIN', 30),
  };
}

const TIMER_MS = 15_000;
const OK_TTL_MS = 2 * 60_000;

export class RulesEngine {
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private bus: EventBus,
    private agg: Aggregate,
    private onAlertsChanged: () => void,
    private thresholds: RuleThresholds = defaultThresholds(),
  ) {}

  start(): void {
    this.unsubscribe = this.bus.subscribe((e) => this.onEvent(e));
    this.timer = setInterval(() => this.tick(), TIMER_MS);
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  // ---------- 告警生命周期（去重 + 自动恢复） ----------

  private raise(alert: Alert): void {
    const prev = this.agg.alerts.get(alert.key);
    // 去重：同 key 同等级不重复产生；等级升级（WARN→CRIT）则更新
    if (prev && prev.level === alert.level && !prev.ephemeral) return;
    this.agg.alerts.set(alert.key, alert);
    this.onAlertsChanged();
  }

  private recover(key: string): void {
    if (this.agg.alerts.delete(key)) this.onAlertsChanged();
  }

  // ---------- 事件触发规则 ----------

  private onEvent(e: AgentEvent): void {
    switch (e.type) {
      case 'quota.snapshot':
        this.checkQuota(e);
        break;
      case 'approval.request': {
        const id = e.agent_id ?? 'unknown';
        this.raise({
          key: `waiting:${id}`,
          level: 'WARN',
          title: '等待审批',
          message: `agent ${id} 进入 waiting，等待人工审批：${String(e.payload.action ?? '')}`,
          ts: e.ts,
          ephemeral: false,
        });
        break;
      }
      case 'agent.resumed':
        if (e.agent_id) {
          this.recover(`waiting:${e.agent_id}`);
          this.recover(`blocked:${e.agent_id}`);
        }
        break;
      case 'task.done': {
        const taskId = String(e.payload.task_id ?? '');
        const t = this.agg.tasks.get(taskId);
        this.raise({
          key: `done:${t?.id ?? taskId}:${e.id}`,
          level: 'OK',
          title: '任务完成',
          message: `任务 ${t?.id ?? taskId}（${t?.title ?? '未命名'}）已完成`,
          ts: e.ts,
          ephemeral: true,
        });
        break;
      }
      default:
        break;
    }
  }

  private checkQuota(e: AgentEvent): void {
    const p = e.payload as {
      account_id?: string;
      windows?: { label: string; remaining_pct: number; resets_at: string | null }[];
    };
    if (!p.account_id || !Array.isArray(p.windows)) return;
    for (const w of p.windows) {
      const key = `quota:${p.account_id}:${w.label}`;
      const name = `${p.account_id} ${w.label}`;
      if (w.remaining_pct <= this.thresholds.quotaCritPct) {
        this.raise({
          key,
          level: 'CRIT',
          title: '配额告急',
          message: `${name} 剩余 ${w.remaining_pct}%（≤${this.thresholds.quotaCritPct}%），建议停止向该账号派单`,
          ts: e.ts,
          ephemeral: false,
        });
      } else if (w.remaining_pct <= this.thresholds.quotaWarnPct) {
        this.raise({
          key,
          level: 'WARN',
          title: '配额偏低',
          message: `${name} 剩余 ${w.remaining_pct}%（≤${this.thresholds.quotaWarnPct}%）`,
          ts: e.ts,
          ephemeral: false,
        });
      } else {
        this.recover(key); // 自动恢复
      }
      this.checkReset(p.account_id, w.label, w.resets_at);
    }
  }

  private checkReset(accountId: string, label: string, resetsAt: string | null): void {
    const key = `reset:${accountId}:${label}`;
    if (!resetsAt) {
      this.recover(key);
      return;
    }
    const msLeft = new Date(resetsAt).getTime() - Date.now();
    if (msLeft > 0 && msLeft < this.thresholds.resetInfoMin * 60_000) {
      this.raise({
        key,
        level: 'INFO',
        title: '配额即将重置',
        message: `${accountId} ${label} 将在 ${Math.ceil(msLeft / 60_000)} 分钟后重置`,
        ts: nowIso(),
        ephemeral: false,
      });
    } else {
      this.recover(key);
    }
  }

  // ---------- 定时巡检（blocked 超时 / 重置临近 / OK 过期） ----------

  private tick(): void {
    const now = Date.now();
    for (const a of this.agg.agents.values()) {
      const key = `blocked:${a.id}`;
      if (a.status === 'blocked' && a.blocked_since) {
        const ms = now - new Date(a.blocked_since).getTime();
        if (ms >= this.thresholds.blockedWarnMin * 60_000) {
          this.raise({
            key,
            level: 'WARN',
            title: 'agent 阻塞超时',
            message: `${a.name} 已阻塞 ${Math.floor(ms / 60_000)} 分钟：${a.blocked_reason ?? '原因未知'}`,
            ts: nowIso(),
            ephemeral: false,
          });
        }
      } else {
        this.recover(key);
      }
    }
    for (const acc of this.agg.accounts.values()) {
      for (const w of acc.windows) this.checkReset(acc.id, w.label, w.resets_at);
    }
    // OK 类短暂告警到期清理
    let changed = false;
    for (const [key, alert] of this.agg.alerts) {
      if (alert.ephemeral && now - new Date(alert.ts).getTime() > OK_TTL_MS) {
        this.agg.alerts.delete(key);
        changed = true;
      }
    }
    if (changed) this.onAlertsChanged();
  }
}
