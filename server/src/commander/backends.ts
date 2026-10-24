import { spawn, spawnSync } from 'node:child_process';
import type { KeyStore } from '../security/secrets.js';
import { log } from '../security/redact.js';

/**
 * FR-8 CommanderBackend 抽象与降级链：
 * kimi（默认，Kimi Code CLI 非交互模式）→ deepseek（OpenAI 兼容 HTTP）→ 本地模板回复（标注降级）。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  tokens: number;
  degraded: boolean;
  backend: string;
}

export interface CommanderBackend {
  readonly name: string;
  available(): Promise<boolean>;
  chat(messages: ChatMessage[]): Promise<ChatResult>;
}

/** Kimi Code CLI 非交互模式（启动时探测可用性）。 */
export class KimiCliBackend implements CommanderBackend {
  readonly name = 'kimi';
  private ok: boolean | null = null;

  async available(): Promise<boolean> {
    if (this.ok !== null) return this.ok;
    try {
      const r = spawnSync('kimi --version', { shell: true, timeout: 5000, stdio: 'pipe' });
      this.ok = r.status === 0;
    } catch {
      this.ok = false;
    }
    if (!this.ok) log.warn('[commander] 未探测到可用的 kimi CLI，指挥后端将降级。');
    return this.ok;
  }

  chat(messages: ChatMessage[]): Promise<ChatResult> {
    const prompt = messages
      .map((m) => (m.role === 'system' ? `<system>\n${m.content}\n</system>` : m.content))
      .join('\n\n');
    return new Promise((resolve, reject) => {
      const child = spawn('kimi', ['-p', prompt], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('kimi CLI 调用超时'));
      }, 120_000);
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 && out.trim()) {
          resolve({ text: out.trim(), tokens: 0, degraded: false, backend: this.name });
        } else {
          reject(new Error(`kimi CLI 退出码 ${code}: ${err.slice(0, 200)}`));
        }
      });
    });
  }
}

/** DeepSeek OpenAI 兼容 HTTP API。 */
export class DeepSeekBackend implements CommanderBackend {
  readonly name = 'deepseek';

  constructor(private keystore: KeyStore) {}

  async available(): Promise<boolean> {
    return Boolean(this.keystore.deepseekApiKey);
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const key = this.keystore.deepseekApiKey;
    if (!key) throw new Error('未配置 DeepSeek API Key');
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, max_tokens: 1024, stream: false }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`DeepSeek API HTTP ${res.status}`);
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek API 响应缺少内容');
    return { text, tokens: json.usage?.total_tokens ?? 0, degraded: false, backend: this.name };
  }
}

/** 兜底：本地模板回复，始终可用，明确标注降级。 */
export class LocalTemplateBackend implements CommanderBackend {
  readonly name = 'local-template';

  constructor(private summarize: () => string) {}

  async available(): Promise<boolean> {
    return true;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    const text =
      `【本地模板回复 · 降级模式】已收到你的消息：「${(last?.content ?? '').slice(0, 200)}」。\n` +
      `当前指挥模型后端不可用（kimi CLI 未探测到，DeepSeek API Key 未配置），以下为本地状态摘要：\n` +
      this.summarize();
    return { text, tokens: 0, degraded: true, backend: this.name };
  }
}
