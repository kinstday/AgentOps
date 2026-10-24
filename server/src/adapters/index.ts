import { spawn } from 'node:child_process';
import type { AgentEvent, EventBus, SourceName } from '../core/events.js';
import { createEvent, isEventType, nowIso, ulid } from '../core/events.js';
import type { AgentState } from '../core/aggregate.js';

/**
 * §8.1-A2 端口-适配器：内核只依赖 SourceAdapter 抽象。
 * 新增来源 = 新增一个适配器文件，内核零改动。
 */
export interface SourceAdapter {
  readonly name: SourceName;
  /** 只读来源：无输入通道（@转发提示不可对话）、无控制通道 */
  readonly readonly: boolean;
  /** hook 回调原文 → 统一事件（可为多个） */
  ingest(raw: unknown): AgentEvent[];
  /** §7.4 控制通道（可选；无通道时 API 返回只读提示） */
  control?: {
    pause(agent: AgentState): void;
    resume(agent: AgentState): void;
  };
  /** FR-8 @转发通道（可选；M2 用 mock 子进程模拟） */
  forward?(agentName: string, text: string): Promise<string>;
}

/** 把 hook 上报的原始载荷归一化为 AgentEvent（宽松解析，缺字段补全）。 */
export function normalizeRawEvents(source: SourceName, raw: unknown): AgentEvent[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const out: AgentEvent[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (!isEventType(r.type)) continue;
    out.push({
      id: typeof r.id === 'string' ? r.id : ulid(),
      ts: typeof r.ts === 'string' ? r.ts : nowIso(),
      source,
      agent_id: typeof r.agent_id === 'string' ? r.agent_id : null,
      type: r.type,
      payload: (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Record<string, unknown>,
    });
  }
  return out;
}

/** M2 演示：@转发降级链默认走「CLI 非交互新会话」，此处用 mock 子进程模拟一次性执行入口。 */
export function mockForwardProcess(agentName: string, text: string): Promise<string> {
  const reply =
    `【${agentName} · 模拟转发会话】已收到指令：「${text.slice(0, 120)}」。` +
    `当前为 M2 演示通道（mock 子进程非交互会话），真实 CLI 非交互转发接入后替换。`;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        process.execPath,
        ['-e', `setTimeout(()=>process.stdout.write(${JSON.stringify(reply)}),200)`],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      resolve(reply);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(reply);
    }, 5000);
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => {
      clearTimeout(timer);
      resolve(out.trim() || reply);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(reply);
    });
  });
}

export function createKimiAdapter(): SourceAdapter {
  return {
    name: 'kimi-code',
    readonly: false,
    ingest: (raw) => normalizeRawEvents('kimi-code', raw),
    forward: (agentName, text) => mockForwardProcess(agentName, text),
  };
}

export function createCodexAdapter(): SourceAdapter {
  return {
    name: 'codex',
    readonly: false,
    ingest: (raw) => normalizeRawEvents('codex', raw),
    forward: (agentName, text) => mockForwardProcess(agentName, text),
  };
}

/** DeepSeek 侧 agent 走 OTel 通道，只读（无输入/控制通道，§7.4）。 */
export function createOtelAdapter(): SourceAdapter {
  return {
    name: 'deepseek-otel',
    readonly: true,
    ingest: (raw) => normalizeRawEvents('deepseek-otel', raw),
  };
}

/** mock 适配器：演示/测试用，具备控制通道与转发通道。 */
export function createMockAdapter(bus: EventBus): SourceAdapter {
  return {
    name: 'mock',
    readonly: false,
    ingest: (raw) => normalizeRawEvents('mock', raw),
    control: {
      pause(agent) {
        bus.publish(createEvent('mock', agent.id, 'agent.blocked', { reason: 'paused-by-operator' }));
      },
      resume(agent) {
        bus.publish(createEvent('mock', agent.id, 'agent.resumed', {}));
      },
    },
    forward: (agentName, text) => mockForwardProcess(agentName, text),
  };
}

/** hook 路径参数 → 适配器名 */
export const HOOK_SOURCE_MAP: Record<string, SourceName> = {
  kimi: 'kimi-code',
  codex: 'codex',
  otel: 'deepseek-otel',
  mock: 'mock',
};

export class AdapterRegistry {
  private byName = new Map<SourceName, SourceAdapter>();

  constructor(bus: EventBus) {
    for (const a of [createKimiAdapter(), createCodexAdapter(), createOtelAdapter(), createMockAdapter(bus)]) {
      this.byName.set(a.name, a);
    }
  }

  forSource(source: SourceName): SourceAdapter | undefined {
    return this.byName.get(source);
  }

  forHookParam(param: string): SourceAdapter | undefined {
    const name = HOOK_SOURCE_MAP[param];
    return name ? this.byName.get(name) : undefined;
  }
}
