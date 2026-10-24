import path from 'node:path';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import type { WSContext } from 'hono/ws';
import { EventBus, nowIso } from './core/events.js';
import { Aggregate } from './core/aggregate.js';
import { RulesEngine } from './core/rules.js';
import { Db } from './db/index.js';
import { KeyStore } from './security/secrets.js';
import { log } from './security/redact.js';
import { AdapterRegistry } from './adapters/index.js';
import { QuotaCollector } from './quota/collector.js';
import { CommanderService } from './commander/service.js';

/**
 * AgentOps 本地后端入口：单进程模块化单体（§8.1-A5）。
 * 绑定 127.0.0.1:4711，REST + WS。
 */

const HOST = '127.0.0.1';
const PORT = Number(process.env.AGENTOPS_PORT ?? 4711);

const baseDir = process.env.AGENTOPS_HOME ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.agentops');
const keystore = new KeyStore(baseDir);
const hookToken = keystore.loadOrCreateHookToken();

const db = new Db(process.env.AGENTOPS_DB ?? path.join(baseDir, 'agentops.db'));
const bus = new EventBus();
const agg = new Aggregate(db);

// 1) 启动重放（§8.1-A3）：先于订阅，避免重放事件重复落库/告警
agg.replay();

// 2) 订阅链：持久化 → 聚合 → 规则引擎 → WS 推送
bus.subscribe((e) => {
  db.insertEvent(e);
  if (e.type === 'quota.snapshot') db.insertQuotaSnapshots(e);
});
bus.subscribe((e) => agg.apply(e));

const wsClients = new Set<WSContext>();
function broadcast(obj: unknown): void {
  const data = JSON.stringify(obj);
  for (const ws of wsClients) {
    try {
      ws.send(data);
    } catch {
      wsClients.delete(ws);
    }
  }
}
bus.subscribe((e) => broadcast({ type: 'event', data: e }));

const rules = new RulesEngine(bus, agg, () => {
  broadcast({ type: 'alerts', data: [...agg.alerts.values()] });
});
rules.start();

const adapters = new AdapterRegistry(bus);
const quota = new QuotaCollector(db, bus, keystore);
quota.start();

const commander = new CommanderService(bus, agg, db, adapters, keystore);
await commander.init();

// ---------- HTTP ----------

const app = new Hono();
app.use('/api/*', cors());
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.get('/api/health', (c) => c.json({ ok: true, ts: nowIso() }));

app.get('/api/state', (c) =>
  c.json({
    ...agg.snapshot(),
    commander: { backend: commander.backendName, degraded: commander.backendName === 'local-template' },
  }),
);

// hook 回调入口（§7.1 鉴权：X-AgentOps-Token）
app.post('/api/hooks/:source', async (c) => {
  const token = c.req.header('X-AgentOps-Token');
  if (token !== hookToken) {
    return c.json({ ok: false, error: 'unauthorized: 缺少或错误的 X-AgentOps-Token' }, 401);
  }
  const adapter = adapters.forHookParam(c.req.param('source'));
  if (!adapter) {
    return c.json({ ok: false, error: `未知来源 ${c.req.param('source')}（支持 kimi/codex/otel/mock）` }, 404);
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }
  const events = adapter.ingest(raw);
  for (const e of events) bus.publish(e);
  return c.json({ ok: true, accepted: events.length, ids: events.map((e) => e.id) });
});

// 控制回传（§7.4；无通道返回只读提示）
for (const action of ['pause', 'resume'] as const) {
  app.post(`/api/agents/:id/${action}`, (c) => {
    const agent = agg.agents.get(c.req.param('id'));
    if (!agent) return c.json({ ok: false, error: `agent ${c.req.param('id')} 不存在` }, 404);
    const adapter = adapters.forSource(agent.source);
    if (!adapter?.control) {
      return c.json({ ok: false, readonly: true, message: `来源 ${agent.source} 只读，无控制通道` }, 409);
    }
    adapter.control[action](agent);
    return c.json({ ok: true, agent_id: agent.id, action });
  });
}

// 配额快照历史（画趋势用）
const RANGE_MS: Record<string, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};
app.get('/api/accounts/:id/quota', (c) => {
  const id = c.req.param('id');
  if (!agg.accounts.has(id)) return c.json({ ok: false, error: `账号 ${id} 不存在` }, 404);
  const range = c.req.query('range') ?? '1h';
  const ms = RANGE_MS[range] ?? RANGE_MS['1h'];
  const since = nowIso(new Date(Date.now() - ms));
  return c.json({ ok: true, account_id: id, range, snapshots: db.quotaHistory(id, since) });
});

// 指挥台（FR-8）
app.post('/api/command', async (c) => {
  let body: { target?: string; text?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }
  if (!body.text || typeof body.text !== 'string') {
    return c.json({ ok: false, error: '缺少 text 字段' }, 400);
  }
  const result = await commander.handle(body.target, body.text);
  return c.json(result, result.ok ? 200 : 502);
});

app.get('/api/command/history', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
  return c.json({ ok: true, history: db.commandHistory(limit) });
});

// WS 事件推送：{type:"event", data: AgentEvent} / {type:"alerts", data: Alert[]}
app.get(
  '/api/stream',
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: 'hello', data: { ts: nowIso() } }));
    },
    onClose(_evt, ws) {
      wsClients.delete(ws);
    },
    onError(_evt, ws) {
      wsClients.delete(ws);
    },
  })),
);

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  log.info(`[agentops] 后端已启动: http://${HOST}:${info.port} (WS: /api/stream)`);
  log.info(`[agentops] hook token 文件: ${keystore.hookTokenFile}`);
});
injectWebSocket(server);

function shutdown(): void {
  log.info('[agentops] 正在关闭…');
  quota.stop();
  rules.stop();
  db.close();
  server.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
