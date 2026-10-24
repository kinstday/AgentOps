import type { EventBus } from '../core/events.js';
import { createEvent, nowIso } from '../core/events.js';
import type { Db } from '../db/index.js';
import type { KeyStore } from '../security/secrets.js';
import { log } from '../security/redact.js';

/**
 * §7.3 QuotaCollector：轮询产出 quota.snapshot 事件 → 落库 + WS 推送。
 * - DeepSeek：真实接口 GET https://api.deepseek.com/user/balance，60s 周期；
 *   无 Key 或请求失败 → 自动降级 mock 并标注 demo: true。
 * - Kimi Code / Codex：M1 允许 mock 占位（界面标注「演示数据」），30s 周期。
 * - 消耗速率：近 1h 快照最小二乘斜率（窗口型 %/h，余额型 ¥/h）。
 *
 * mock 初始值可用环境变量校准（验收/演示用）：
 *   AGENTOPS_MOCK_KIMI_PCT / AGENTOPS_MOCK_CODEX_PCT / AGENTOPS_MOCK_DEEPSEEK_BALANCE
 */

const DEEPSEEK_INTERVAL_MS = 60_000;
const WINDOW_INTERVAL_MS = 30_000;
const RATE_WINDOW_MS = 60 * 60 * 1000;

interface MockWindow {
  label: string;
  remaining_pct: number;
  resets_at: string | null;
  reset_after_ms: number | null; // 到重置点的周期，重置后重新计
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 近 1h 最小二乘斜率（每小时变化量，负值为消耗）。 */
export function slopePerHour(points: { t: number; y: number }[]): number | null {
  if (points.length < 2) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 3_600_000);
  const ys = points.map((p) => p.y);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

export class QuotaCollector {
  private timers: NodeJS.Timeout[] = [];
  private kimiWindows: MockWindow[];
  private codexWindows: MockWindow[];
  private mockBalance: number;
  private deepseekDemo: boolean;

  constructor(
    private db: Db,
    private bus: EventBus,
    private keystore: KeyStore,
  ) {
    const now = Date.now();
    this.kimiWindows = [
      {
        label: '5h 窗口',
        remaining_pct: envNum('AGENTOPS_MOCK_KIMI_PCT', 62),
        resets_at: new Date(now + 2.7 * 3_600_000).toISOString(),
        reset_after_ms: 5 * 3_600_000,
      },
      { label: '周限额', remaining_pct: 81, resets_at: null, reset_after_ms: null },
    ];
    this.codexWindows = [
      {
        label: '5h 窗口',
        remaining_pct: envNum('AGENTOPS_MOCK_CODEX_PCT', 74),
        resets_at: new Date(now + 1.2 * 3_600_000).toISOString(),
        reset_after_ms: 5 * 3_600_000,
      },
      { label: '周限额', remaining_pct: 66, resets_at: null, reset_after_ms: null },
    ];
    this.mockBalance = envNum('AGENTOPS_MOCK_DEEPSEEK_BALANCE', 58.3);
    this.deepseekDemo = !this.keystore.deepseekApiKey;
    if (this.deepseekDemo) {
      log.warn('[quota] 未配置 DeepSeek API Key，deepseek 账号使用演示数据（demo: true）。可运行 npm run setup:key 配置。');
    }
  }

  start(): void {
    // 启动立即采集一轮，让首屏有数据
    void this.collectDeepSeek();
    this.collectWindows('kimi', this.kimiWindows);
    this.collectWindows('codex', this.codexWindows);
    this.timers.push(setInterval(() => void this.collectDeepSeek(), DEEPSEEK_INTERVAL_MS));
    this.timers.push(
      setInterval(() => {
        this.collectWindows('kimi', this.kimiWindows);
        this.collectWindows('codex', this.codexWindows);
      }, WINDOW_INTERVAL_MS),
    );
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ---------- DeepSeek（真实接口，失败降级 mock） ----------

  private async collectDeepSeek(): Promise<void> {
    const key = this.keystore.deepseekApiKey;
    if (!key) {
      this.emitDeepseekMock();
      return;
    }
    try {
      const res = await fetch('https://api.deepseek.com/user/balance', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        balance_infos?: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[];
      };
      const infos = json.balance_infos ?? [];
      const cny = infos.find((i) => i.currency === 'CNY') ?? infos[0];
      if (!cny) throw new Error('响应缺少 balance_infos');
      const total = parseFloat(cny.total_balance);
      const granted = parseFloat(cny.granted_balance);
      const toppedUp = parseFloat(cny.topped_up_balance);
      this.deepseekDemo = false;
      this.bus.publish(
        createEvent('system', null, 'quota.snapshot', {
          account_id: 'deepseek',
          quota_kind: 'balance',
          demo: false,
          balance_cny: total,
          balance_detail: { total, granted, topped_up: toppedUp },
          rate_per_h: this.rate('deepseek', null),
        }),
      );
    } catch (err) {
      if (!this.deepseekDemo) {
        log.warn(`[quota] DeepSeek 余额查询失败，降级演示数据：${err instanceof Error ? err.message : String(err)}`);
      }
      this.deepseekDemo = true;
      this.emitDeepseekMock();
    }
  }

  private emitDeepseekMock(): void {
    this.mockBalance = Math.max(0, this.mockBalance - (0.02 + Math.random() * 0.06));
    const b = Math.round(this.mockBalance * 100) / 100;
    this.bus.publish(
      createEvent('system', null, 'quota.snapshot', {
        account_id: 'deepseek',
        quota_kind: 'balance',
        demo: true,
        balance_cny: b,
        balance_detail: { total: b, granted: Math.round(b * 0.17 * 100) / 100, topped_up: Math.round(b * 0.83 * 100) / 100 },
        rate_per_h: this.rate('deepseek', null),
      }),
    );
  }

  // ---------- Kimi Code / Codex（mock 占位） ----------

  private collectWindows(accountId: 'kimi' | 'codex', windows: MockWindow[]): void {
    const now = Date.now();
    for (const w of windows) {
      w.remaining_pct = Math.max(3, Math.round((w.remaining_pct - (0.1 + Math.random() * 0.3)) * 10) / 10);
      if (w.resets_at && new Date(w.resets_at).getTime() <= now) {
        w.remaining_pct = 100;
        w.resets_at = new Date(now + (w.reset_after_ms ?? 5 * 3_600_000)).toISOString();
      }
    }
    this.bus.publish(
      createEvent('system', null, 'quota.snapshot', {
        account_id: accountId,
        quota_kind: 'window',
        demo: true,
        windows: windows.map((w) => ({
          label: w.label,
          remaining_pct: w.remaining_pct,
          resets_at: w.resets_at,
          rate_per_h: this.rate(accountId, w.label),
        })),
      }),
    );
  }

  private rate(accountId: string, windowLabel: string | null): number | null {
    const since = nowIso(new Date(Date.now() - RATE_WINDOW_MS));
    const points = this.db.quotaPoints(accountId, windowLabel, since);
    const s = slopePerHour(points);
    return s === null ? null : Math.round(s * 100) / 100;
  }
}
