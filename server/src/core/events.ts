import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

/**
 * §7.1 统一事件模型。
 * id 为 ULID，ts 为 ISO8601 带时区偏移的本地时间。
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
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type SourceName = 'kimi-code' | 'codex' | 'deepseek-otel' | 'mock' | 'system';

export interface AgentEvent {
  id: string;
  ts: string;
  source: SourceName;
  agent_id: string | null;
  type: EventType;
  payload: Record<string, unknown>;
}

export function isEventType(t: unknown): t is EventType {
  return typeof t === 'string' && (EVENT_TYPES as readonly string[]).includes(t);
}

/** §8.1-A3：仅生命周期事件参与启动重放；quota.snapshot / command.* 只取最新。 */
export function isLifecycleEvent(type: EventType): boolean {
  return (
    type.startsWith('agent.') ||
    type.startsWith('task.') ||
    type.startsWith('dag.') ||
    type.startsWith('approval.')
  );
}

// ---------- ULID（Crockford Base32，48bit 时间 + 80bit 随机） ----------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function ulid(): string {
  let time = Date.now();
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[time % 32] + timePart;
    time = Math.floor(time / 32);
  }
  const buf = randomBytes(10);
  let v = 0n;
  for (const b of buf) v = (v << 8n) | BigInt(b);
  let randPart = '';
  for (let i = 0; i < 16; i++) {
    randPart = CROCKFORD[Number(v % 32n)] + randPart;
    v /= 32n;
  }
  return timePart + randPart;
}

/** ISO8601 带本地时区偏移，如 2026-10-23T14:02:11.123+08:00 */
export function nowIso(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const offMin = -d.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offMin) / 60));
  const om = pad(Math.abs(offMin) % 60);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${sign}${oh}:${om}`
  );
}

export function createEvent(
  source: SourceName,
  agentId: string | null,
  type: EventType,
  payload: Record<string, unknown> = {},
): AgentEvent {
  return { id: ulid(), ts: nowIso(), source, agent_id: agentId, type, payload };
}

/**
 * 进程内事件总线（§8.1-A1：明确不用外部 MQ）。
 * 适配器 → 总线 → 聚合层 / 规则引擎 / 持久化 / WS 推送。
 */
export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  publish(event: AgentEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }
}
