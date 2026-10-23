# AgentOps 中控台 · 需求设计文档

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0 |
| 状态 | 待实施 |
| 目标读者 | Kimi Code（AI 编码代理）/ 开发工程师 |
| 关联产物 | 已有前端原型（React + Tailwind，深色任务控制室风格），本文档的 UI 规格与之对应 |

---

## 1. 背景与目标

用户（下称「操作员」）同时使用三个 AI 编程来源——**DeepSeek（API 按量计费）、Kimi Code（订阅窗口额度 + 加油包）、ChatGPT/Codex（订阅 5h/周限额 + Credits）**——以及运行在它们之上的多个编码代理（agent）。目前存在两个痛点：

1. **多 agent 协同过程不可见**：每个 agent 用什么模型、在执行什么任务、是否卡住，只能靠逐个翻终端窗口确认。
2. **账号配额不可见**：各平台的 code plan 剩余量分散在不同 CLI / 网页里，经常出现任务跑到一半配额耗尽、被迫中断。

**项目目标**：做一个本地运行的可视化中控台（Dashboard），实时聚合所有 agent 的运行状态与所有 AI 账号的配额余量，并提供告警与人工审批入口。

**定位**：中控台是**观测层 + 指挥层**——包含一个内置「指挥 agent」作为统一沟通与编排入口（FR-8 / FR-9），但**不做自己的模型推理与代码执行层**：所有任务的实际执行仍交给外部 agent 工具（Kimi Code CLI、Codex CLI、接 DeepSeek API 的自研 agent 等），指挥 agent 只负责理解与拆解，不下场写代码。

**非目标**（本期不做）：

- 不做多人协作与云端同步，纯本地单用户工具。
- 不做移动端 App，桌面浏览器为主。

## 2. 用户与核心场景

唯一角色：操作员（个人开发者）。

| # | 场景 | 期望 |
|---|---|---|
| S1 | 同时跑 3 个编码 agent，扫一眼面板 | 知道每个 agent 的模型、当前任务、进度、是否阻塞 |
| S2 | 某 agent 长时间无产出 | 面板上有明显的阻塞/超时告警 |
| S3 | 准备派一个重任务 | 看到各账号余量与消耗速率，选余量充足的账号 |
| S4 | 配额快烧完 | 提前收到告警，而不是任务失败才发现 |
| S5 | agent 要执行高危操作（如删表迁移） | 在中控台弹审批，批准后 agent 才继续 |
| S6 | 一天结束复盘 | 看时间线回顾各 agent 耗时与成本 |
| S7 | 有一个新需求要启动 | 在指挥台用自然语言描述，指挥 agent 结合当前各 agent 负载与账号余量给出回应 |
| S8 | 需要多 agent 协作的任务 | 指挥 agent 产出拆解方案（DAG 预览），操作员确认/改派后才真正下发执行 |
| S9 | 只想单独纠正某个 agent | 在指挥台 @该 agent 直接对话，不经过指挥 agent |
| S10 | 任务跑到一半发现方向不对 | 收到指挥 agent 的介入建议后一键纠偏，或随时主动 @agent 插入指令，不必等任务失败 |

## 3. 名词约定

| 名词 | 含义 |
|---|---|
| Agent | 一个正在运行的 AI 编码代理实例（如一个 Kimi Code 或 Codex CLI 会话） |
| Task | agent 正在执行的任务，有全局唯一 ID（如 T-2041） |
| Account | 一个 AI 平台的账号/订阅（如 Kimi Code 会员主号、ChatGPT Plus 号、DeepSeek API 账户） |
| 窗口配额 | 按固定周期重置的额度（如 Kimi Code / Codex 的 5h 窗口、周限额），对应「余额型」配额（DeepSeek 账户余额） |
| HITL | Human-in-the-loop，人工审批节点 |
| A2A Bus | agent 之间及 agent 与操作员之间的消息总线 |

## 4. 范围分期

| 里程碑 | 内容 | 对应场景 |
|---|---|---|
| **M1（MVP）** | Agent 状态卡片、账号配额面板、本地后端 + WebSocket 推送、SQLite 持久化 | S1, S3 |
| **M2** | 任务编排 DAG、执行时间线、通信流、告警滚动条、**指挥台对话（含 @点名转发）** | S2, S4, S6, S7, S9 |
| **M3** | **编排提议与确认流、事中介入与纠偏**、HITL 审批回传、消耗预测、派单建议、Session 回放 | S5, S8, S10 |

本文档给出完整设计，实施按 M1 → M2 → M3 顺序，每个里程碑都应可独立运行演示。

---

## 5. 功能需求

### FR-1 Agent 舰队监控（M1）

以卡片网格展示所有 agent，每张卡片包含：

| 字段 | 说明 |
|---|---|
| agent 名称 | 如 `coder-frontend` |
| 角色 | 编排 / 前端 / 后端 / 审查 / 调研 / 文档 |
| 模型与厂商 | 如 `Kimi K3 · Moonshot`、`GPT-6 Sol · OpenAI`、`DeepSeek V3.2 · DeepSeek` |
| 所属账号 | 该 agent 消耗的是哪个 Account 的配额 |
| 状态 | 状态机：`running / waiting / blocked / idle / done / error`，颜色编码 + LED 呼吸灯（running/waiting/blocked 呼吸） |
| 当前任务 | 任务 ID + 一句话描述 |
| 进度 | **M1 不展示进度条**——CLI agent 无法自报真实进度，该字段不可采集；M1 以状态 + 已运行时长 + token 消耗代替。M3 起由指挥 agent 依据该 agent 的工具调用历史估算并展示，UI 必须标注「估算」 |
| 消耗 | 累计 token 数与折算成本（¥） |
| 已运行时长 | HH:MM:SS |

交互：

- 顶部状态筛选 chips（全部/执行中/待审批/阻塞/空闲/已完成），带数量徽标。
- 卡片操作按钮：`暂停 / 恢复`（仅 running/idle 态）；`批准 / 拒绝`（仅 waiting 态，见 FR-7）；`对话`（唤起指挥台并预填 `@该agent`，适配器为只读来源时此按钮置灰，见 FR-8）。
- 空状态：筛选无结果时显示虚线框提示。

### FR-2 任务编排 DAG（M2）

- 用 SVG 有向图展示当前会话的任务依赖：`需求输入 → orchestrator → 各子 agent → reviewer → 合并发布`。
- 节点显示 agent 名 + 模型，边框颜色 = 状态色；活跃边用流动虚线动画（stroke-dashoffset），非活跃边为静态暗色虚线。
- 图下方放状态图例。
- 数据来源：orchestrator 类 agent 的派发事件（见 §7 事件模型中的 `task.dispatch`）。

### FR-3 执行时间线（M2）

- 甘特图，一行一个 agent，横轴为时间（默认近 48 分钟窗口，可切换 48m / 3h / 24h）。
- 每个任务一段色条，颜色 = 状态色，条内标注 `任务ID + 简述`，hover 显示完整信息。
- 右缘画 NOW 标线。

### FR-4 账号配额监控（M1）

三个账号分属两种配额形态，卡片组件必须同时支持：

| 形态 | 账号 | 主指标 | 辅助指标 |
|---|---|---|---|
| **窗口型** | Kimi Code、ChatGPT/Codex | 窗口剩余百分比（大号数字 + 进度条，≤40% 琥珀、≤15% 红 +「告急」标） | 重置倒计时（秒级走动）、次级窗口（5h / 周 / 月并列）、消耗速率 %/h |
| **余额型** | DeepSeek | 账户余额（¥，大号数字；细分为总额/充值/赠送） | 消耗速率 ¥/h、预计可用天数（余额 ÷ 近 7 天日均消耗）；无重置概念，不显示倒计时 |

通用字段：平台与套餐名（如 `Kimi Code · 会员 · 主号`）、预计可用时长（<2h 标红）。

特别规则：**同一 ChatGPT 账号下的多个 Codex agent 共享同一份额度**，所以 Codex 卡片按账号聚合，不按 agent 分开计数；卡片上可标注当前共享该额度的 agent 数。

底部固定一条**派单建议**（M3 前可用静态规则）：窗口型余量 <15% 或余额型预计可用 <1 天的账号建议停用。推荐规则**不做跨形态等价换算**（各平台模型单价与能力不同，换算是伪精确）：窗口型账号互比余量百分比，取最高者；DeepSeek 余额型作为按量计费兜底，在窗口型账号全部告急时顶上。

### FR-5 通信流 A2A Bus（M2）

- 消息列表，自动滚动到底部。每条：时间戳、类型标签（`派发/回报/审批/系统`）、`from → to`、正文。
- 类型用左侧 3px 色条区分：派发=青、回报=绿、审批=琥珀、系统=灰。
- 数据来源：agent hooks 上报的 `message.*` 事件。

### FR-6 告警（M2）

- 顶部 ticker 滚动条轮播当前告警，分级 `CRIT / WARN / OK / INFO`，悬停暂停滚动。
- 告警规则（本地规则引擎，配置化阈值）：
  - 账号窗口配额 ≤15% → CRIT；≤40% → WARN
  - agent `blocked` 超过 N 分钟（默认 10）→ WARN
  - agent 进入 `waiting`（等待审批）→ WARN
  - 任务完成 → OK
  - 窗口配额即将重置（<30min）→ INFO

### FR-7 人工审批 HITL（M3）

- agent 通过 hook 上报 `approval.request`（含操作描述、风险说明、命令预览）。
- 中控台把该 agent 置为 `waiting`，卡片上出现`批准 / 拒绝`按钮，并弹通知。
- 操作员点击后，后端通过该 agent 的应答通道（hook 响应 / IPC）放行或终止；超时（默认 5 分钟）自动拒绝。

### FR-8 指挥台对话（M2）

中控台上的统一沟通入口，界面为右下悬浮按钮唤起的抽屉式对话面板（宽 ~380px）。

**两种沟通对象**：

1. **指挥 agent（默认对象）**：操作员用自然语言描述需求或提问。指挥 agent 是后端内的一个 LLM 会话服务（`CommanderService`），可向系统提示词注入当前系统状态摘要（在线 agent 及各自任务、三账号配额余量、未决告警，控制在 ~2k token 内）。**注入时机**：仅新会话首轮、以及操作员显式询问状态类问题时注入；普通追问走滑动窗口——避免每轮重复注入造成固定 token 开销。
   - 指挥 agent 使用的模型账号可在三个账号中配置切换，默认策略：**DeepSeek API**（成本最低，指挥任务以理解/规划为主，不需要最强模型）。其消耗计入对应账号配额，在配额面板可见。
2. **@具体 agent**：输入以 `@agent名` 开头时（如 `@coder-frontend 把进度条改成环形`），消息不经过指挥 agent，由后端通过该 agent 适配器的输入通道转发；回复回流到同一面板，按对话线程分组展示。转发通道按**降级链**实现：
   - ①（可选，默认关闭）注入正在运行的交互式 CLI 会话（如 tmux send-keys）——TUI 程序可能丢字符、无法可靠提交，仅作尽力而为；
   - ②（**默认**）用 CLI 的非交互模式开启新会话转发（一次性执行入口），携带必要上下文——代价是失去原会话的上下文延续；
   - ③（兜底）适配器不支持任何输入通道时，发送即提示「该 agent 只读，无法对话」。

其他要求：

- 所有对话落库（`commands` 表），面板可翻历史，刷新不丢。
- 面板头部始终显示当前对话对象与其模型/账号；从 agent 卡片上的「对话」按钮唤起面板时自动预填 `@该agent`。
- 操作员消息与 agent 回复通过 WS 实时推送，输入框有发送中/失败重发状态。

### FR-9 编排提议与确认流（M3）

**编排决策权归属：指挥 agent 负责提议，操作员握有最终决定权，未确认前任何任务不得下发。**

触发：指挥 agent 判断操作员的需求需要多 agent 协作（或操作员输入 `/plan` 强制触发）。

流程（方案状态机：`proposed → confirmed / rejected`，改派不改状态）：

1. 指挥 agent 产出**结构化编排方案**：任务列表（标题、角色、建议模型与账号、预估消耗档位、依赖关系），格式为 JSON，存 `dag_proposals` 表。
2. 中控台将方案渲染为**预览 DAG**（复用 FR-2 组件，节点为虚线待确认样式），每个节点标注建议账号与理由（如「前端任务 → Kimi Code，余量 78%」）。
3. 操作员三选一：
   - **确认** → 后端按拓扑序通过各适配器下发，预览 DAG 转为正式 DAG，产生 `task.dispatch` 事件流；
   - **单任务改派** → 节点上下拉更换账号/agent，实时校验目标账号余量，改完再确认；
   - **拒绝** → 附一句话理由回流给指挥 agent，由其修订后重新提议（保留历史版本可对比）。
4. **硬约束**（指挥 agent 出方案时必须遵守，后端二次校验）：窗口型余量 <15% 或余额型预计可用 <1 天的账号不可被派单；违反时该方案标注「不可执行」并给出替代派单建议。
5. 方案中每个任务的消耗预估**只给档位**（小 / 中 / 大），档位边界参照本机历史同角色任务的 P50 / P90 自动校准；禁止输出伪精确 token 数（指挥 agent 估不准，精确数字会误导派单决策）。

### FR-10 事中介入与纠偏（M3）

指挥 agent 不止事前编排——任务执行途中操作员必须能随时插入，及时纠正方向。

- **值守监测**：`CommanderService` 订阅事件总线，识别跑偏信号：agent 阻塞超时、同一错误反复重试（≥3 次）、token 消耗超过同角色任务历史 P90、近期消息流与任务目标明显偏离（指挥 agent 定期轻量评估，频率可配，默认 5 分钟一次）。
- **介入建议**：命中信号时，指挥 agent 生成介入建议推送到指挥台并上告警 ticker（WARN 级）：哪个 agent、观察到的现象、建议动作（继续观察 / 发送纠偏指令 / 暂停 / 终止）。**指挥 agent 不自动执行任何纠偏动作**——它只建议，执行权在操作员。
- **一键纠偏**：操作员在建议上点「发送纠偏指令」（文案可编辑）后，指令经 FR-8 的 @转发通道送达执行 agent；或直接选择暂停 / 终止（走 §7.4 控制通道）。
- **随时插入**：操作员任何时候都可以在指挥台 @执行中的 agent 直接发纠偏消息，无需等待介入建议——值守监测只是兜底，操作员永远可以抢先。

### FR-11 历史与回放（M3，可后置）

- 所有事件落 SQLite；可按会话回放：拖动时间轴重现 agent 状态变迁与消息流。
- 周报视图：各模型任务量、成功率、token 成本汇总。

---

## 6. 界面规格（与前端原型一致）

整体：深色「任务控制室」风格，桌面优先（1560px 设计稿基准），信息密度高。

**设计令牌**：

```
背景        #050810    面板    #0C1220 / #111A2B    边框  #1A2540
主文本      #D7E2F2    次文本  #8FA1C2               弱文本 #56678C
执行中/主色 #22D3EE    正常/完成 #34D399             警告   #FBBF24
阻塞/告急   #F87171    辅助强调  #E879F9
字体        JetBrains Mono + Noto Sans SC（中英文混排，中文禁斜体）
```

**布局**（自上而下）：

1. 固定顶栏（60px）：雷达动画 Logo、`LIVE` 徽标、agent 计数摘要（在线/执行中/待审批/阻塞）、本地时钟、操作员名。
2. 告警 ticker（滚动条，hover 暂停）。
3. Agent 舰队卡片网格（1/2/3 列响应式）。
4. 中部两列：左 2/3 = DAG + 甘特时间线；右 1/3 = 账号配额面板。
5. 底部通栏：通信流（两列网格，内部滚动）。
6. 页脚：版本号、数据源接入状态。
7. **指挥台**：右下悬浮按钮（雷达图标），唤起右侧抽屉式对话面板（~380px）；有待确认编排方案时按钮上挂琥珀色角标。

DAG 组件需支持两种模式：**正式态**（实线，由已确认方案驱动）与**预览态**（虚线 + 待确认角标，由 FR-9 编排方案驱动），预览态底部固定「确认 / 拒绝」操作条。

**动效**：状态 LED 呼吸（1.6s）、雷达扫描（4.2s 线性）、ticker 滚动（48s）、DAG 流动线；全部遵守 `prefers-reduced-motion`。

---

## 7. 数据源接入设计（核心难点）

所有外部数据统一收敛为**事件模型**，后端只做聚合转发，前端只消费事件流。

### 7.1 统一事件模型

```jsonc
{
  "id": "evt_01J...",           // ULID
  "ts": "2026-10-23T14:02:11+08:00",
  "source": "kimi-code",         // 来源适配器：kimi-code / codex / deepseek-otel
  "agent_id": "coder-frontend",  // 可空（账号级事件无 agent）
  "type": "task.progress",       // 见下表
  "payload": { }
}
```

| 事件类型 | 载荷要点 | 触发 |
|---|---|---|
| `agent.register` | name, role, model, vendor, account_id | agent 启动 |
| `task.start` | task_id, title | 任务开始 |
| `task.progress` | task_id, progress, tokens, cost, estimated（true = 指挥 agent 估算值） | 周期性/工具调用后 |
| `task.done` / `task.error` | task_id, result / reason | 结束 |
| `task.dispatch` | from_agent, to_agent, task_id | 编排派发（驱动 DAG） |
| `agent.blocked` / `agent.resumed` | reason | 阻塞/恢复 |
| `message.send` | from, to, kind, text | A2A 消息 |
| `approval.request` | agent_id, action, detail, timeout_sec | HITL 申请 |
| `quota.snapshot` | account_id, window, remaining_pct, resets_at | 配额采集 |
| `command.send` / `command.reply` | target, text, tokens | 指挥台对话（操作员发出 / agent 回复） |
| `dag.propose` | proposal_id, spec | 指挥 agent 产出编排方案 |
| `dag.confirm` / `dag.reject` | proposal_id, feedback? | 操作员确认 / 拒绝方案 |

**发号规则**：全局任务 ID（如 T-2041）由后端聚合层统一分配；来源上报的本地任务标识存入 `tasks.local_task_id` 做映射，避免多来源编号冲突。

**回调鉴权**：`127.0.0.1` 只防外网、防不了本机其他进程伪造事件。服务启动时生成随机 token 写入 `~/.agentops/hook-token`（权限 0600）；所有 `POST /api/hooks/*` 请求必须带 `X-AgentOps-Token` 头，适配器注册时从该文件读取并写入对应 CLI 的 hook 配置。

### 7.2 Agent 状态采集（三个通道，按优先级）

1. **CLI hooks / 事件通道（首选）**：Kimi Code 与 Codex CLI 均提供会话事件/通知类机制（如会话启动、工具调用前后、会话结束、桌面通知回调），配置为回调本后端 `POST /api/hooks/kimi` 与 `POST /api/hooks/codex`。接入前先对当前安装的 CLI 版本做能力探测（查版本号与配置项是否存在），探测失败自动降级到通道 3。
2. **OTel 通道**：接 DeepSeek API 的自研 agent / 编排框架（LangGraph、CrewAI 等）按 OpenTelemetry GenAI 语义约定上报 span，后端起一个 OTLP 接收端。这是 DeepSeek 侧 agent 状态的主要来源（DeepSeek 官方无带 hooks 的编码 CLI，agent 壳通常是自研或第三方）。
3. **日志轮询通道（兜底）**：对无 hook 能力的工具，tail 其本地会话日志（Codex 为 `~/.codex` 下 JSONL，Kimi Code 为其会话记录文件）做增量解析。

适配器接口：`interface SourceAdapter { name: string; ingest(raw: unknown): AgentEvent[] }`，新增来源只加一个适配器。

### 7.3 配额采集（DeepSeek / Kimi Code / ChatGPT-Codex）

| 平台 | 配额形态 | 采集方式 | 轮询周期 |
|---|---|---|---|
| **DeepSeek** | 余额型 | 官方接口 `GET https://api.deepseek.com/user/balance`（`Authorization: Bearer <API Key>`），返回总额/充值/赠送余额，结构稳定。用量明细的网页接口（platform.deepseek.com）属于私有接口、需网页会话令牌，**本期不接** | 60s |
| **Kimi Code** | 窗口型 | 本地子进程执行 CLI 的 `/usage` 并解析输出（token 用量、上下文消耗、配额信息）；加油包余额可从其输出行一并解析。需处理 CLI 版本升级导致的输出格式漂移——解析器按关键字锚定，失败时降级为「未知」并告警，不抛异常 | 30s |
| **ChatGPT / Codex** | 窗口型 | 优先级：① 若环境有活跃 Codex CLI 会话，子进程注入 `/status` 解析 5h 窗口与周限额百分比；② 解析 Codex 本地会话日志（`~/.codex` 下的 JSONL）折算 token 消耗；③ 重置时间在 CLI 中不给出，标注「以 chatgpt.com/codex/settings/usage 页面为准」并留配置项让操作员手动校准 | 30s |

统一由 `QuotaCollector` 轮询，产出 `quota.snapshot` 事件并落库；消耗速率用近 1 小时快照做最小二乘斜率估算（余额型换算为 ¥/h，窗口型为 %/h）。

`quota.snapshot` 事件载荷相应扩展：

```jsonc
{
  "type": "quota.snapshot",
  "payload": {
    "account_id": "deepseek",
    "quota_kind": "balance",            // balance | window
    "balance_cny": 123.45,              // 余额型专用
    "balance_detail": { "total": 123.45, "granted": 10.0, "topped_up": 113.45 },
    "windows": [                        // 窗口型专用，可多个
      { "label": "5h 窗口", "remaining_pct": 34, "resets_at": "2026-10-23T16:30:00+08:00" },
      { "label": "周限额", "remaining_pct": 61, "resets_at": null }   // null = 来源未提供
    ]
  }
}
```

### 7.4 控制回传

- `暂停 / 恢复 / 批准 / 拒绝` 通过各适配器的控制通道下发（如 CLI hooks 的响应、tmux send-keys 兜底）。
- 不支持控制通道的来源，按钮置灰并提示「该来源只读」。

---

## 8. 技术架构

### 8.1 架构风格与关键决策

| # | 决策 | 内容 | 理由 / 取舍 |
|---|---|---|---|
| A1 | **事件驱动架构（EDA）** | 所有数据源产出统一事件（§7.1），经**进程内事件总线**流转：适配器 → 总线 → 聚合层 / 规则引擎 / 持久化 / WS 推送，各环节互不感知 | 来源可插拔；告警、回放都是事件流上的普通消费者。明确**不用** Kafka/Redis 等外部 MQ——本地单用户工具，进程内 EventEmitter 足够，外部 MQ 是过度设计 |
| A2 | **端口-适配器（六边形架构）** | 内核（事件模型、聚合、规则引擎、CommanderService）只依赖抽象端口 `SourceAdapter`；Kimi Code / Codex / DeepSeek / OTel 各为一个适配器实现 | 三家平台接入方式差异大且会随版本漂移；新增来源 = 新增一个适配器文件，内核零改动 |
| A3 | **事件溯源（简化版）** | `events` 表是唯一事实源；「当前状态」是事件的内存物化视图，崩溃后由事件重放重建。**重建规则**：仅 `agent.* / task.* / dag.* / approval.*` 生命周期事件参与重建；`quota.snapshot`、`command.*` 只取最新一条记录，不参与重放（否则每次启动都要重放数万条快照） | M3 的 Session 回放因此不需要单独设计——按时间重放事件即可重建任意时刻的盘面 |
| A4 | **前端单向数据流** | WS 事件 → store → 组件渲染；组件不直接改本地状态等后端追认。首屏 `GET /api/state` 全量对齐 + WS 增量更新，断线重连后重新全量对齐 | 多面板共享同一份状态（卡片、DAG、甘特、顶栏计数），单向流避免状态分叉 |
| A5 | **单进程模块化单体** | 后端一个进程、模块化分层（adapters / core / commander / quota / db） | 不选微服务：无分布式需求，拆分只会增加部署与调试成本 |

### 8.2 部署拓扑

```
┌────────────────────────────────────────────────┐
│  前端 Dashboard（React + TS + Vite + Tailwind） │
│  消费 WebSocket 事件流，渲染六大面板             │
└──────────────▲─────────────────────────────────┘
               │ WS /api/stream  +  REST /api/*
┌──────────────┴─────────────────────────────────┐
│  本地后端（Node 22 + Hono，或 Python FastAPI）   │
│  ├─ 适配器层：Kimi hooks / Codex hooks / OTLP   │
│  ├─ 聚合层：事件 → 当前状态（内存态）            │
│  ├─ CommanderService：指挥 agent 会话、状态摘要   │
│  │   注入、编排方案生成、@消息转发                 │
│  ├─ 规则引擎：告警阈值 + 派单硬约束校验           │
│  ├─ QuotaCollector：配额轮询                     │
│  └─ SQLite（better-sqlite3）：事件与快照持久化    │
└──────────────▲─────────────────────────────────┘
               │ hook 回调 / 日志 / CLI 子进程
        各 AI agent 进程、各平台配额来源
```

约束：

- 只绑定 `127.0.0.1`，默认端口后端 `4711`、前端 dev `4712`。
- API key / token 存 `~/.agentops/config.enc`（机器密钥派生加密），禁止入库入日志；日志中对 `Bearer`、`token` 值自动脱敏。
- 后端单进程即可，不引入 Docker / K8s。
- 事件总线为进程内实现（如 EventEmitter / RxJS Subject），禁止替换为外部中间件。

### 8.3 模块划分

建议目录结构：

```
agentops/
├─ server/           # 后端
│  ├─ adapters/      # kimi.ts codex.ts deepseek.ts otel.ts ...
│  ├─ core/          # 事件模型、聚合、规则引擎
│  ├─ commander/     # 指挥 agent：会话管理、方案生成、@转发
│  ├─ quota/         # 配额采集器
│  └─ db/            # SQLite schema 与迁移
├─ web/              # 前端（可移植原型代码）
└─ docs/
```

## 9. 数据模型（SQLite）

```sql
CREATE TABLE agents (
  id TEXT PRIMARY KEY,          -- agent_id
  name TEXT NOT NULL,
  role TEXT, model TEXT, vendor TEXT,
  account_id TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  created_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,          -- 全局任务 ID，后端统一发号（如 T-2041）
  local_task_id TEXT,           -- 来源侧的本地任务标识（映射用，防多来源撞号）
  agent_id TEXT REFERENCES agents(id),
  title TEXT, progress INTEGER DEFAULT 0,
  tokens INTEGER DEFAULT 0, cost REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT, ended_at TEXT
);

CREATE TABLE events (           -- 全量事件流水，回放用
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT, agent_id TEXT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL         -- JSON
);
CREATE INDEX idx_events_ts ON events(ts);

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,          -- deepseek / kimi / codex
  name TEXT, plan TEXT,
  quota_kind TEXT NOT NULL,     -- balance（余额型）/ window（窗口型）
  window_label TEXT             -- 窗口型：5h 窗口 / 周限额 / 月额度；余额型为 NULL
);

CREATE TABLE quota_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  window_label TEXT,            -- 余额型为 NULL；窗口型标识是哪个窗口
  remaining_pct REAL,           -- 窗口型专用
  balance_cny REAL,             -- 余额型专用
  resets_at TEXT,               -- 来源未提供时为 NULL
  captured_at TEXT NOT NULL
);
CREATE INDEX idx_quota ON quota_snapshots(account_id, captured_at);

CREATE TABLE commands (             -- 指挥台对话
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  target TEXT NOT NULL,             -- 'commander' 或 agent_id
  direction TEXT NOT NULL,          -- 'in'（操作员发出）/ 'out'（回复）
  text TEXT NOT NULL,
  cost_tokens INTEGER DEFAULT 0
);

CREATE TABLE dag_proposals (        -- 编排方案
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',  -- proposed / confirmed / rejected
  spec TEXT NOT NULL,               -- JSON：任务列表、建议账号、依赖关系
  feedback TEXT                     -- 拒绝理由
);
```

## 10. API 设计

| 方法 & 路径 | 说明 |
|---|---|
| `GET /api/state` | 全量当前状态（agents + tasks + accounts + 未决告警），前端首屏用 |
| `WS /api/stream` | 事件推送：`{type: "event", data: AgentEvent}`；断线自动重连，重连后拉一次 `/api/state` 对齐 |
| `POST /api/hooks/:source` | 各来源 hook 回调入口（`:source` = kimi / codex / otel） |
| `POST /api/agents/:id/pause` · `POST /api/agents/:id/resume` | 暂停/恢复 |
| `POST /api/agents/:id/approve` · `POST /api/agents/:id/reject` | HITL 审批 |
| `GET /api/accounts/:id/quota?range=1h` | 配额快照历史（画趋势用） |
| `POST /api/command` | 指挥台发消息 `{target: "commander" \| agent_id, text}`；回复经 WS 推送 |
| `GET /api/command/history?limit=50` | 对话历史 |
| `GET /api/dags` · `POST /api/dags/:id/confirm` · `POST /api/dags/:id/reject` · `PATCH /api/dags/:id` | 编排方案：列表 / 确认下发 / 拒绝 / 单任务改派 |

## 11. 非功能需求

| 类别 | 要求 |
|---|---|
| 性能 | 10 agent 并发、事件 100/min 时 UI 无卡顿；WS 推送延迟 <500ms |
| 可靠性 | 单适配器崩溃不影响整体；来源断连时对应卡片 5 分钟无事件自动标灰「失联」 |
| 安全 | 仅 localhost；密钥加密存储、日志脱敏；HITL 审批默认超时拒绝 |
| 降级 | 无任何数据源接入时，前端以演示模式（mock 数据）运行并明确标注 |
| 可访问性 | 中文禁斜体；状态色对比度 ≥3:1；动效支持 prefers-reduced-motion |

## 12. 验收标准

**M1**：
1. 启动后端 + 前端，演示模式可见 Agent 舰队与配额面板，倒计时/token 实时走动。
2. 用 curl 模拟 `POST /api/hooks/kimi` 上报一条 `task.progress`，对应卡片 1 秒内更新。
3. 配额采集 **M1 只强制 DeepSeek 一家真实接通**（余额每 60s 落库，`/api/accounts/:id/quota` 可查历史）；Kimi Code / Codex 允许以 mock 适配器占位（界面标注「演示数据」），真实接通在 M1 后跟进——不让最脆弱的来源绑架 M1 完工标准。余额型卡片不显示重置倒计时，窗口型卡片显示。

**M2**：DAG 随 `task.dispatch` 事件实时增减边；告警规则触发并出现在 ticker；甘特图数据与任务记录一致。指挥台发一条消息给指挥 agent 能收到回复；`@agent` 消息经 mock 适配器转发并回流展示，只读来源正确提示不可对话。

**M3**：模拟 `approval.request` 后卡片出现审批按钮；点批准后适配器收到放行指令并记录事件。指挥 agent 产出编排方案后渲染预览 DAG（虚线态）；确认后产生 `task.dispatch` 事件且预览转正式；对余量不足的账号派单被后端硬约束拦截并提示替代方案。

## 13. 实施提示（给 Kimi Code）

1. 先做 §7.1 事件模型与内存聚合层 + `GET /api/state` + WS，再接 SQLite，最后写适配器——内核与来源解耦。
2. 前端可基于已有原型项目移植：保留 `src/sections/` 六个面板组件与设计令牌，把 mock 数据替换为 `/api/state` + WS 订阅；保留演示模式作为无数据源时的降级。配额卡片组件需按 §5 FR-4 支持「窗口型 / 余额型」两种形态（原型里只有窗口型）。
3. 配额采集器的推荐落地顺序：**DeepSeek 最先**（官方余额接口，一次 HTTP 调用即可跑通，最快建立信心）→ Kimi Code（CLI `/usage` 解析）→ Codex（`/status` + 本地 JSONL，重置时间缺失需要手动校准配置）。
4. Agent 状态侧推荐顺序：自研 DeepSeek agent 走 OTel 通道（格式自己掌控）→ Kimi Code / Codex 的 hooks 通道 → 日志兜底。
5. 指挥 agent（CommanderService）注意三点：默认走 DeepSeek API 压成本；状态摘要仅在新会话首轮与状态类问题时注入（≤2k token）；编排方案用结构化输出（JSON Schema 约束），解析失败自动重试一次后降级为纯文本回复。
6. @转发默认走「非交互新会话」模式；交互会话注入作为可配置项默认关闭。hooks 回调鉴权按 §7.1 的 `X-AgentOps-Token` 实施，不要省。
7. 全程不要引入重型依赖：无 Redis、无 MQ、无 Docker。
