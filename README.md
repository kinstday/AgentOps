# AgentOps 中控台

面向个人开发者的本地 AI 编码代理监控与指挥面板，聚合 Kimi Code、ChatGPT/Codex 和 DeepSeek 来源的 agent 状态、任务、账号配额与消息。

当前提供 M1/M2 的前后端实现及演示通道：React 看板通过 REST 获取状态快照，再通过 WebSocket 接收增量事件；本地 Node.js 后端负责事件聚合、SQLite 持久化、配额采集、告警和指挥台对话。

## 当前功能与接入状态

| 功能 | 当前实现 |
| --- | --- |
| Agent 舰队 | 状态筛选、任务、运行时长、token 和成本展示 |
| 任务编排图与时间线 | 由 `task.dispatch` 等事件驱动，支持 48m / 3h / 24h 时间窗口 |
| 通信流与告警 | 展示 `message.send`、配额偏低、阻塞超时、待审批及任务完成通知 |
| DeepSeek 余额 | 配置 API Key 后调用真实余额接口；无 Key 或查询失败时回退到演示数据 |
| Kimi / Codex 配额 | 当前为模拟数据，账号卡片标注“演示数据” |
| 指挥台 | Kimi CLI / DeepSeek 模型对话、本地模板兜底、对话历史和失败重发 |
| `@agent` 对话 | Kimi / Codex / mock 来源目前均通过模拟子进程回复；未接入真实 agent 会话 |
| 暂停 / 恢复 | 只有 mock 适配器实现控制通道；Kimi / Codex 暂无控制通道，OTel 来源只读 |
| HITL 与 M3 编排 | 审批回传、方案确认执行、事中纠偏等尚未实现 |

`LIVE` 表示前端已连接后端，不代表所有来源都是真实数据。仅启动前端时，首次连接后端失败会切换到 `DEMO`，并每 15 秒重试连接；演示对话不落库。后端启动后不会自动发现本机 CLI 会话，需要外部来源主动上报事件。

## 环境与安装

- Node.js 22（至少 22.12）或 Node.js 24，以及 npm。本项目已在 Node.js 24 环境完成构建与类型检查。
- 后端使用 `better-sqlite3` 原生模块；安装时需要与 Node.js 版本匹配的预编译产物，或可用的本地编译环境。
- Kimi CLI 和 DeepSeek API Key 均为可选项；缺少时仍可运行演示功能。

在项目根目录安装前后端依赖：

```powershell
npm ci
npm --prefix server ci
```

前后端使用独立的 `package.json` 和锁文件，根目录安装不会自动安装后端依赖。

## 启动

在项目根目录打开两个终端。

终端一，启动后端：

```powershell
npm --prefix server run dev
```

终端二，启动前端：

```powershell
npm run dev
```

- 前端：<http://127.0.0.1:4712>
- 后端健康检查：<http://127.0.0.1:4711/api/health>
- WebSocket：`ws://127.0.0.1:4711/api/stream`

Vite 开发服务器将 `/api` 的 HTTP 和 WebSocket 请求代理到 `127.0.0.1:4711`。如果修改后端端口，也需要修改 `vite.config.ts` 中的代理目标。`server` 的 `dev` 和 `start` 当前都通过 `tsx` 运行源码，`dev` 未启用文件监听重启。

## 配置与本地数据

服务端默认使用当前用户主目录下的 `.agentops`，Windows 通常为 `%USERPROFILE%\.agentops`：

| 文件 | 用途 |
| --- | --- |
| `agentops.db` | SQLite 事件、任务、配额快照和对话历史；运行时可能同时生成 WAL/SHM 文件 |
| `hook-token` | Hook 上报使用的随机 token，首次启动自动生成 |
| `master-key` | 配置加密主密钥 |
| `config.enc` | 使用 AES-256-GCM 加密的配置，例如 DeepSeek API Key |

这些文件属于本机运行数据，不应提交到仓库。

配置 DeepSeek API Key：

```powershell
npm --prefix server run setup:key
```

按终端提示输入 Key，再重启后端。配置完成后，后端每 60 秒查询一次 DeepSeek 余额；真实余额接入仍需使用有效账号验证。模型对话会消耗对应账号的额度。

指挥后端在启动时默认按 Kimi CLI、DeepSeek、local-template 的顺序选择可用项。也可以在启动后端前设置偏好，例如：

```powershell
$env:AGENTOPS_COMMANDER_BACKEND = 'deepseek'
npm --prefix server run dev
```

当前选中的后端调用失败时，运行时直接回退到本地模板回复。

主要环境变量在启动后端的终端设置：

| 变量 | 默认值 / 说明 |
| --- | --- |
| `AGENTOPS_PORT` | `4711`；后端固定绑定 `127.0.0.1` |
| `AGENTOPS_HOME` | 服务端数据与密钥目录，默认用户主目录下 `.agentops` |
| `AGENTOPS_DB` | 单独指定 SQLite 路径，默认数据目录下 `agentops.db` |
| `AGENTOPS_COMMANDER_BACKEND` | 偏好后端：`kimi`、`deepseek` 或 `local-template` |
| `AGENTOPS_MOCK_KIMI_PCT` | Kimi 主窗口演示初始余量，默认 `62` |
| `AGENTOPS_MOCK_CODEX_PCT` | Codex 主窗口演示初始余量，默认 `74` |
| `AGENTOPS_MOCK_DEEPSEEK_BALANCE` | DeepSeek 演示初始余额，默认 `58.3` |
| `AGENTOPS_RULE_QUOTA_CRIT` | 窗口配额严重告警阈值，默认 `15`（%） |
| `AGENTOPS_RULE_QUOTA_WARN` | 窗口配额预警阈值，默认 `40`（%） |
| `AGENTOPS_RULE_BLOCKED_MIN` | 阻塞告警阈值，默认 `10`（分钟） |
| `AGENTOPS_RULE_RESET_MIN` | 配额重置提醒阈值，默认 `30`（分钟） |

`setup:key` 当前固定使用默认 `.agentops` 目录，不读取 `AGENTOPS_HOME`；自定义服务端目录时需要保持密钥配置的位置一致。

## 上报事件

Hook 入口为 `POST /api/hooks/:source`，必须提供 `X-AgentOps-Token` 请求头。路径来源支持 `kimi`、`codex`、`otel` 和 `mock`。当前适配器接收统一事件格式，不会直接解析各 CLI 原生日志或标准 OTLP 请求。

以下 PowerShell 示例在后端启动后登记一个 mock agent 并上报任务状态：

```powershell
$hookToken = (Get-Content -LiteralPath (Join-Path $env:USERPROFILE '.agentops/hook-token') -Raw).Trim()
$headers = @{ 'X-AgentOps-Token' = $hookToken }
$events = @(
    @{
        type = 'agent.register'
        agent_id = 'example-agent'
        payload = @{
            name = 'example-agent'
            role = '开发'
            model = 'mock-model'
            account_id = 'kimi'
        }
    },
    @{
        type = 'task.start'
        agent_id = 'example-agent'
        payload = @{ task_id = 'example-task-1'; title = '验证 Hook 接入' }
    },
    @{
        type = 'task.progress'
        agent_id = 'example-agent'
        payload = @{ task_id = 'example-task-1'; tokens = 1200; cost = 0.01 }
    }
)
$body = ConvertTo-Json -InputObject $events -Depth 6
Invoke-RestMethod -Uri 'http://127.0.0.1:4711/api/hooks/mock' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
```

单次请求可传一个事件或事件数组。事件字段为 `id`、`ts`、`agent_id`、`type`、`payload`；`id` 和 `ts` 省略时由后端补全，`source` 由入口路径确定。接入时先登记 agent，再开始任务，并为任务提供稳定的来源侧 `task_id`。完整事件类型见 `server/src/core/events.ts`。

## 主要接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 |
| GET | `/api/state` | 当前聚合状态与指挥后端信息 |
| POST | `/api/hooks/:source` | 接收统一事件，需要 Hook token |
| GET | `/api/stream` | WebSocket 实时事件与告警 |
| GET | `/api/accounts/:id/quota?range=1h` | 配额历史，范围支持 `1h`、`24h`、`7d` |
| POST | `/api/command` | 对话，JSON 为 `{ "target": "commander", "text": "当前状态如何？" }` |
| GET | `/api/command/history?limit=50` | 最近的对话记录 |
| POST | `/api/agents/:id/pause` | 暂停，仅具备控制通道的适配器支持 |
| POST | `/api/agents/:id/resume` | 恢复，仅具备控制通道的适配器支持 |

目前仅 Hook 入口校验 token，其余接口尚未统一认证，HTTP CORS 也未收紧；当前运行方式面向本机单用户环境。

## 代码结构

```text
src/
  api/                  REST 与 WebSocket 客户端
  store/                当前状态、连接重试、演示模式及指挥台状态
  types/                前端事件与领域类型
  sections/             舰队、DAG、配额、时间线、消息及指挥台
  data/mock.ts          纯前端演示数据
  components/ui/        基础 UI 组件
server/
  src/index.ts          服务组装、HTTP 与 WebSocket 入口
  src/adapters/         来源归一化、模拟转发与控制通道
  src/core/             事件总线、状态聚合及告警规则
  src/db/               SQLite 表结构与数据访问
  src/quota/            配额轮询及消耗速率计算
  src/commander/        会话管理与模型后端
  src/security/         配置加密与日志脱敏
  scripts/setup-key.ts  API Key 配置入口
doc/                    需求设计与实施计划
```

## 工程校验

在项目根目录执行：

```powershell
npm run build
npm run lint
npm --prefix server run typecheck
```

前端产物输出到 `dist/`。根目录 lint 当前排除 `server/`，后端类型检查需要单独执行。当前尚未配置自动化测试命令。

`npm run preview` 只用于前端构建产物预览，未配置开发服务器的 `/api` 代理；完整前后端联调请使用上述双终端启动方式。

## 已知限制与后续工作

- 前后端各自生成任务 ID，新任务的展示 ID 可能不一致；事件重放仍有写库副作用，缺少来源任务 ID 时重启可能重新编号，重复事件也未在聚合前统一去重。
- DAG 按 agent 合并派发关系，遇到从根节点可达的环路可能无法结束布局；接入真实协作前需要环检测及任务级建图。
- 配额恢复未完整保留演示标记等元数据，真实与模拟快照尚未隔离；派单建议仍需增加数据有效期与全部配额窗口的检查。
- 前端待审批卡片已展示批准/拒绝按钮，但后端尚无对应端点，点击会返回 404；真实 HITL 回传属于 M3。
- 指挥会话需要完善固定 system 规则保留、请求串行化，以及 HTTP / WebSocket / 历史记录之间的关联与去重。
- 后续优先补充事件去重、重启恢复、未知 agent、断线恢复和 DAG 环路测试，再推进真实 CLI 转发及 M3 编排。

详细范围见 [需求设计文档](doc/AgentOps中控台-需求设计文档.md) 和 [M1/M2 实施计划](doc/实施计划-M1-M2.md)。
