import type { EventBus } from '../core/events.js';
import { createEvent, ulid, nowIso } from '../core/events.js';
import type { Aggregate } from '../core/aggregate.js';
import type { AdapterRegistry } from '../adapters/index.js';
import type { Db } from '../db/index.js';
import type { KeyStore } from '../security/secrets.js';
import { log } from '../security/redact.js';
import {
  DeepSeekBackend,
  KimiCliBackend,
  LocalTemplateBackend,
  type ChatMessage,
  type ChatResult,
  type CommanderBackend,
} from './backends.js';

/**
 * FR-8 CommanderService：指挥 agent 会话服务。
 * - 会话管理：操作员单会话（滑动窗口）+ 每 agent 线程（commands 表 target 字段区分）。
 * - 后端降级链：kimi（默认，探测 CLI）→ deepseek → 本地模板（标注降级）。
 * - 状态摘要注入：仅新会话首轮与状态类问题时注入，其余走滑动窗口。
 * - @agent 转发降级链：适配器无输入通道（deepseek-otel）→ 提示只读。
 */

const HISTORY_WINDOW = 12;
const STATUS_QUESTION = /(状态|配额|余量|告警|在线|进展|情况|汇报|status|quota|alert)/i;

export interface CommandResult {
  ok: boolean;
  target: string;
  reply: string;
  backend?: string;
  degraded?: boolean;
  readonly?: boolean;
  error?: string;
}

export class CommanderService {
  private backends: CommanderBackend[];
  private activeBackend: CommanderBackend | null = null;
  /** 指挥 agent 单会话滑动窗口 */
  private session: ChatMessage[] = [];

  constructor(
    private bus: EventBus,
    private agg: Aggregate,
    private db: Db,
    private adapters: AdapterRegistry,
    keystore: KeyStore,
  ) {
    this.backends = [
      new KimiCliBackend(),
      new DeepSeekBackend(keystore),
      new LocalTemplateBackend(() => this.buildSummary()),
    ];
  }

  async init(): Promise<void> {
    const preferred = process.env.AGENTOPS_COMMANDER_BACKEND;
    const ordered = preferred
      ? [...this.backends].sort((a, b) => (a.name === preferred ? -1 : b.name === preferred ? 1 : 0))
      : this.backends;
    for (const b of ordered) {
      if (await b.available()) {
        this.activeBackend = b;
        break;
      }
    }
    log.info(`[commander] 指挥后端：${this.activeBackend?.name ?? 'none'}${
      this.activeBackend?.name === 'local-template' ? '（降级模式）' : ''
    }`);
  }

  get backendName(): string {
    return this.activeBackend?.name ?? 'none';
  }

  // ---------- 状态摘要（≤2k token，仅首轮/状态类问题注入） ----------

  buildSummary(): string {
    const s = this.agg.snapshot();
    const lines: string[] = [];
    const agents = s.agents;
    lines.push(`agent 共 ${agents.length} 个：`);
    for (const a of agents) {
      const task = a.current_task ? `，当前任务 ${a.current_task.id}（${a.current_task.title ?? '未命名'}）` : '';
      lines.push(`- ${a.name} [${a.status}] ${a.model ?? '未知模型'} @${a.account_id ?? '未知账号'}${task}`);
    }
    lines.push('账号配额：');
    for (const acc of s.accounts) {
      if (acc.quota_kind === 'balance') {
        lines.push(`- ${acc.name}：余额 ¥${acc.balance_cny ?? '未知'}${acc.demo ? '（演示数据）' : ''}`);
      } else {
        const ws = acc.windows.map((w) => `${w.label} ${w.remaining_pct}%`).join('，');
        lines.push(`- ${acc.name}：${ws || '暂无数据'}${acc.demo ? '（演示数据）' : ''}`);
      }
    }
    const alerts = s.alerts;
    lines.push(alerts.length ? `未决告警 ${alerts.length} 条：` : '未决告警：无');
    for (const al of alerts) lines.push(`- [${al.level}] ${al.message}`);
    return lines.join('\n');
  }

  // ---------- 入口 ----------

  async handle(targetRaw: string | undefined, text: string): Promise<CommandResult> {
    const at = /^@([\w-]+)\s*([\s\S]*)$/.exec(text.trim());
    const target = at ? at[1] : targetRaw && targetRaw !== 'commander' ? targetRaw : 'commander';
    const body = at ? at[2] : text;

    this.record('in', target, text);
    this.bus.publish(createEvent('system', null, 'command.send', { target, text }));

    if (target === 'commander') {
      return this.commanderReply(body);
    }
    return this.forwardToAgent(target, body);
  }

  // ---------- 指挥 agent ----------

  private async commanderReply(text: string): Promise<CommandResult> {
    const injectSummary = this.session.length === 0 || STATUS_QUESTION.test(text);
    const messages: ChatMessage[] = [];
    if (injectSummary) {
      messages.push({
        role: 'system',
        content:
          '你是 AgentOps 中控台的指挥 agent，负责理解操作员需求、结合系统状态给出回应；你不直接执行代码任务。\n' +
          '当前系统状态摘要：\n' + this.buildSummary(),
      });
    }
    this.session.push({ role: 'user', content: text });
    if (this.session.length > HISTORY_WINDOW) this.session.splice(0, this.session.length - HISTORY_WINDOW);
    messages.push(...this.session);

    const chain = this.activeBackend
      ? [this.activeBackend, this.backends[this.backends.length - 1]]
      : [this.backends[this.backends.length - 1]];
    let result: ChatResult | null = null;
    let lastErr: unknown = null;
    for (const b of chain) {
      try {
        result = await b.chat(messages);
        break;
      } catch (err) {
        lastErr = err;
        log.warn(`[commander] 后端 ${b.name} 调用失败，尝试降级：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (!result) {
      const msg = `指挥后端全部不可用：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`;
      return { ok: false, target: 'commander', reply: msg, error: msg };
    }

    this.session.push({ role: 'assistant', content: result.text });
    this.record('out', 'commander', result.text, result.tokens);
    this.bus.publish(
      createEvent('system', null, 'command.reply', {
        target: 'commander',
        text: result.text,
        tokens: result.tokens,
        backend: result.backend,
        degraded: result.degraded,
      }),
    );
    return {
      ok: true,
      target: 'commander',
      reply: result.text,
      backend: result.backend,
      degraded: result.degraded,
    };
  }

  // ---------- @agent 转发（降级链） ----------

  private async forwardToAgent(target: string, text: string): Promise<CommandResult> {
    const agent =
      this.agg.agents.get(target) ?? [...this.agg.agents.values()].find((a) => a.name === target);
    if (!agent) {
      const reply = `未找到名为 ${target} 的 agent，无法转发。`;
      this.record('out', target, reply);
      this.bus.publish(createEvent('system', null, 'command.reply', { target, text: reply, tokens: 0 }));
      return { ok: false, target, reply, error: reply };
    }
    const adapter = this.adapters.forSource(agent.source);
    if (!adapter || adapter.readonly || !adapter.forward) {
      const reply = `该 agent（${agent.name}，来源 ${agent.source}）只读，无法对话。`;
      this.record('out', target, reply);
      this.bus.publish(
        createEvent('system', agent.id, 'command.reply', { target: agent.id, text: reply, tokens: 0, readonly: true }),
      );
      return { ok: true, target: agent.id, reply, readonly: true };
    }
    let reply: string;
    try {
      reply = await adapter.forward(agent.name, text);
    } catch (err) {
      reply = `转发失败：${err instanceof Error ? err.message : String(err)}`;
    }
    this.record('out', agent.id, reply);
    this.bus.publish(createEvent('system', agent.id, 'command.reply', { target: agent.id, text: reply, tokens: 0 }));
    return { ok: true, target: agent.id, reply };
  }

  private record(direction: 'in' | 'out', target: string, text: string, tokens = 0): void {
    this.db.insertCommand({ id: ulid(), ts: nowIso(), target, direction, text, cost_tokens: tokens });
  }
}
