# NOVA 功能、接口与后端运行逻辑

> 本文按当前代码整理。所有金额均使用最小货币单位（CNY 分）；当前项目是挑战赛概念沙箱，不连接真实银行账户或真实资金。

## 1. 产品主链路

NOVA 当前的核心不是聊天，而是 Goal-first 的受治理闭环：

1. Goal Readiness：用户描述目标，Agent 只负责提取金额、日期和约束。
2. Feasibility：确定性引擎用 Financial Twin、现金流、安全余额和受保护资金判断目标是否可行。
3. Plan Activation：用户选择方案并明确确认；激活目标不等于授权自动转账。
4. Goal Impact：后续消费或现金流变化超过阈值时生成影响信号，说明延期、资金缺口和最小调整方案。
5. Governed Execution：需要资金动作时依次经过 Approval Snapshot、Permission、Risk、Execute、Verify、Audit。

默认权限始终是 `recommend`。LLM 可以理解和规划，不能给自己授权，也不能直接执行资金操作。

## 2. 页面功能与当前接入状态

| 页面 | 用户看到的能力 | 当前数据/逻辑来源 |
|---|---|---|
| Today | 目标进度、额外消费对延期天数的影响、查看原因 | 前端 fixture 和公式模拟 |
| Agent | 自然语言目标、意图解析、计划、授权快照、Permission、Risk、Receipt | Live AI 输入调用 `/api/agent`；确认执行后的完整流水目前仍使用前端 Agent Runtime 模拟 |
| Life | 目标方案、What-if、Mandate、外部 Agent 请求、购物确认/拒绝、安全攻击演示 | 主要使用前端 simulator、external-agent-runtime 和 security demo |
| Twin | 账户、账单、订阅、目标竞争、安全余额、授权余量、证据链和操作前后对比 | 前端 Financial Twin 模型；同类计算也已存在于 Banking Tools 后端 |
| Activity | 分类筛选、审计详情、未知状态按原 Operation ID 查询 | 当前由前端 Activity Ledger 生成和更新 |

因此，目前“展示闭环”完整，“后端能力层”也已建立，但二者还没有全部接线。真正端到端走服务端的主要入口是 `/api/agent`；Goal Flow 和 Banking Tools 可独立调用，但页面尚未全面使用它们。

## 3. HTTP 接口

### 3.1 `POST /api/agent`

用途：真实 Agent Runtime 入口。把自然语言目标变成结构化意图、计划和受控工具调用。

请求：

```json
{ "message": "我想准备 8000 元日本旅行预算，不动应急金" }
```

触发逻辑：

1. 每 IP 每分钟最多 8 次。
2. 校验消息长度 2–800 字。
3. Prompt Injection 检测；命中越权、泄露提示、绕过审批等规则时，不调用外部模型，直接进入确定性降级。
4. 未命中攻击时按 Qwen → DeepSeek 顺序尝试，12 秒超时，输出必须通过严格 Zod Schema。
5. 模型只能规划白名单工具。
6. 只读工具立即由服务端执行；写工具只返回 `requires_approval`，本轮绝不执行。
7. 模型未配置、超时或输出非法时，使用确定性解析器生成安全计划。

主要返回：`intent`、`message`、`mode`、`provider`、`fallback`、`plan`、`toolResults`、`security`。

### 3.2 `GET /api/goal-flow`

用途：读取 Goal-first 初始状态、默认通知偏好和 UI/Schema 状态矩阵。

返回默认权限 `recommend`、初始 `draft` 状态、Notification Preferences 和 State Matrix。

### 3.3 `POST /api/goal-flow`

有两种模式：

- 传 `message`：只解析 Goal Intent；模型失败则确定性降级。
- 传 `state + event + preferences`：执行目标状态机流转。

主要事件与触发：

| 事件 | 合法前置状态 | 结果 |
|---|---|---|
| `ASSESS` | 任意初始状态 | 计算可行性，进入 `assessing`、`ready` 或 `failed` |
| `SELECT_SCENARIO` | `ready` | 保存保守/平衡/加速方案 |
| `REQUEST_ACTIVATION` | `ready` 且已选方案 | 进入 `activation_requires_confirmation` |
| `CONFIRM_ACTIVATION` | 等待确认 | 进入 `active` |
| `APPLY_FINANCIAL_CHANGE` | `active/impact_detected` | 超过通知阈值时进入 `impact_detected` |
| `DISMISS_SIGNAL/SNOOZE_SIGNAL` | 有影响信号 | 回到 active，并记录抑制状态 |
| `START_ADJUSTMENT` | `impact_detected` | 进入 `adjusting` |
| `RECOVER` | `failed/adjusting/assessing` | 恢复到 `ready` |

非法状态迁移直接报错，不会静默越级。

### 3.4 `GET /api/banking-tools`

用途：返回 Banking Tool Catalog、输入 Schema、只读/破坏性标记和沙箱声明。

### 3.5 `POST /api/banking-tools`

用途：REST 方式调用单个受治理 Banking Tool。

请求：

```json
{ "tool": "get_financial_snapshot", "input": { "include": ["accounts", "goals"] } }
```

服务端从可信请求头读取用户身份，不采用调用方传入的 userId；每 IP 每分钟最多 60 次。`x-nova-user-confirmed: true` 仅用于第一方 UI 的明确确认步骤。

### 3.6 `GET/POST /api/mcp`

用途：把同一套 Banking Tools 暴露给第三方旅行、出行、电商 Agent。

支持 JSON-RPC 方法：`initialize`、`notifications/initialized`、`tools/list`、`tools/call`。MCP 调用固定 `userConfirmed=false`，所以外部 Agent 不能调用 `confirm_approval` 给自己授权。

## 4. Banking Tools 按功能分组

### Financial Twin 与查询

- `get_financial_snapshot`：账户、目标、现金流、安全余额、Mandate 和数据新鲜度总快照。
- `list_accounts/get_accounts`：脱敏账户与余额。
- `list_transactions/get_transactions`：按账户、日期、分类读取交易。
- `list_bills/get_upcoming_bills`：未来账单。
- `list_subscriptions`：订阅及涨价信息。
- `forecast_cashflow`：计算未来最低余额、安全余额余量、可支配金额、目标延期和缺口。
- `detect_financial_signals`：目标延期、订阅涨价、临近账单等信号。

### 目标规划

- `assess_goal_feasibility`：基于 Scenario Fixture 计算 on_track、at_risk、infeasible 或 insufficient_data。
- `simulate_goal_plan`：生成保守、平衡、加速三种方案。
- `compare_scenarios`：对投入压力排序。
- `get_goal_progress`：读取进度和预计完成日期。
- `prepare_goal_adjustment`：准备调金额、日期或投入的方案，不直接写入。
- `create_goal/update_goal`：审批后创建或修改目标，要求一次性 Approval Token 和 Idempotency Key。

### 转账与换汇

- `prepare_transfer/prepare_internal_transfer`：生成转账草稿、预估余额和风险，不移动资金。
- `execute_transfer/execute_internal_transfer`：验证快照、审批、风险和幂等后执行模拟转账。
- `quote_fx`：生成 60 秒有效的模拟汇率报价。
- `prepare_fx_order`：校验报价有效期并生成换汇草稿。
- `execute_fx_order`：审批后模拟换汇。
- `get_operation_status`：工具超时后按原 Operation ID 查询；禁止盲目重试。

### Approval、Permission、Risk 与审计

- `create_approval_snapshot`：冻结 action 和 parameters，并生成 SHA-256 hash。
- `confirm_approval`：只有第一方 UI 明确确认后才生成一次性 Approval Token。
- `permission_check`：检查 Approval Token 或 Mandate 是否覆盖动作。
- `risk_check`：检查余额、安全资金和重复操作。
- `append_audit_event/get_activity`：写入或读取审计记录。
- `export_audit_report`：导出带 previousHash/eventHash 链的 JSON 或 CSV 证据。

### Mandate 与外部 Agent

- `create_mandate/create_recurring_mandate`：创建有主体、类别、单笔/每日/总额和有效期边界的版本化授权。
- `pause_mandate/revoke_mandate`：审批后暂停或撤销，并提升版本号。
- `evaluate_agent_payment/evaluate_external_agent_request`：验证签名、时间戳、nonce、Agent 身份、Mandate 版本/状态/有效期、金额和 Financial Twin 风险，返回 execute、ask、block 或 manual_review。
- `execute_agent_payment/execute_external_payment`：只有前一决策允许，且 ask 类请求已逐笔确认时才执行模拟支付。

### 辅助生活场景

- `compare_cards`：比较卡片外汇费用。
- `explain_decision`：读取已保存决策证据并解释原因。

## 5. 后端写操作的完整运行顺序

标准写操作应按以下顺序触发：

```text
用户/Agent 提出动作
  → Prepare：生成草稿，不执行
  → Approval Snapshot：冻结金额、账户、日期等最终参数
  → User Confirm：第一方 UI 明确确认，签发短期一次性 Token
  → Permission：Token 或 Mandate 是否覆盖该动作
  → Risk：余额、受保护资金、快照新鲜度、高风险和重复操作
  → Execute：调用模拟工具
  → Verify：得到确定结果或保留 unknown
  → Audit：写审计事件和 Receipt
```

关键守卫：

- 参数改变：审批快照不匹配，返回 `APPROVAL_INVALID` 或 `APPROVAL_SNAPSHOT_CHANGED`。
- Token 重放：原子更新失败，返回 `APPROVAL_REPLAY_DETECTED`。
- 幂等键复用且参数相同：返回原 Operation 结果，不重复执行。
- 幂等键复用但参数不同：返回 `IDEMPOTENCY_CONFLICT`。
- 快照变化：返回 `SNAPSHOT_CHANGED`，要求刷新并重新授权。
- 高额转账：金额超过 ¥1,000 时进入 `MANUAL_REVIEW_REQUIRED`。
- 安全余额跌破 ¥3,000：返回 `SAFETY_BUFFER_BREACH`。
- 工具超时：只能显示 `unknown`，随后用原 Operation ID 查询。

## 6. 外部 Agent 支付何时触发什么

1. 外部 Agent 提交已签名请求。
2. 服务端验证 HMAC-SHA256；失败立即阻断。
3. 验证请求时间在 5 分钟内、nonce 未使用；否则认定过期或重放。
4. 读取 Mandate，校验 active、Agent ID、版本和有效日期。
5. 购物类别固定进入 `ask`，必须逐笔确认。
6. 餐饮会额外调用 Financial Twin：不仅看单笔 ¥500 上限，还预测未来 7 天余额是否低于 ¥3,000。
7. 超过 ¥1,000 的请求进入人工复核。
8. `execute` 可进入执行；`ask` 必须有 Approval Token；`block/manual_review` 禁止调用支付工具。
9. 成功后保存 Receipt 和审计事件。

示例：¥680 餐饮既超过 ¥500 单笔授权，又把七日最低余额从 ¥3,400 降到 ¥2,720，因此返回 `MANDATE_AND_SAFETY_BUFFER_BREACH`，支付工具不被调用。

## 7. Goal Impact 的触发规则

当前引擎以目标剩余 ¥3,040 为基数。变化满足以下任一条件才考虑提醒：

- 金额达到用户的 `amountThreshold`；或
- 变化占目标剩余金额的比例达到 `goalImpactRatioThreshold`。

数据必须充足、目标必须已激活、影响必须可行动。满足后按 `changeAmount / 6.25` 估算延期天数；较大影响会把状态改为 at_risk。未达阈值则保持 active，不弹事件型提醒。用户 dismiss/snooze 后保留审计并抑制重复打扰。

## 8. 当前真实程度与下一步

已经真实实现的是：Zod Contracts、Goal 状态机、LLM/确定性降级、服务端工具校验、D1 持久化结构、审批一次性消费、幂等、签名、nonce 防重放、Mandate 状态、风险拦截和审计导出。

仍为模拟数据或尚未全接线的是：真实银行核心账户、真实支付清算、真实客服工单、前端所有页面到 Goal Flow/Banking Tools 的统一调用、持久化前端会话状态，以及生产级身份认证和密钥配置。

推荐下一步是把 UI 逐页切到同一条服务端链路：先接 Agent 的确认执行，再接 Life 外部请求，最后接 Today/Twin/Activity 查询，从而让演示和后端事实完全一致。

## 9. Agent 架构对照与遥测

生产请求只需要提交 `message`，实际架构由服务端 Rollout Gate 决定：

```json
{
  "message": "我想三个月后去日本，预算 8000 元"
}
```

- 财务解释、纯可行性分析、创建目标草案进入 Candidate Router + Goal/Coach Agent。
- 普通修改目标请求进入 Candidate Goal Agent，但只生成重新评估后的 `update_goal` 待审批草案。
- 确认修改、激活计划、转账、支付、扣款和授权仍进入 Baseline/确定性 Workflow。
- Prompt Injection 在模型调用前进入 Safe Reject；Candidate 异常进入受限确定性 fallback。
- 响应的 `architecture` 表示本次实际服务架构，`rollout.stage/reason` 表示 Gate 版本和判定原因。

`architecture: "baseline" | "candidate"` 只用于受控评测，必须同时由服务端设置 `NOVA_EVALUATION_MODE=enabled` 并携带 `x-nova-evaluation-mode: true`。生产环境不启用该开关，客户端无法自行选择架构。

Candidate 的 Goal Agent 可以读取 Twin、执行可行性评估并生成待审批目标草案；Coach Agent 只能读取证据并解释，不拥有目标创建或资金写工具。两者共用完全相同的 Banking Core、Permission、Risk、Audit 和 Financial Twin。

阶段四默认 `NOVA_AGENT_ROLLOUT=phase4`。可依次设为 `phase3`、`phase2` 或 `shadow` 分级回滚。

### 9.1 阶段五目标激活

前端激活方案不再直接修改 Twin，而是依次调用 `create_approval_snapshot`、`confirm_approval` 和 `activate_goal`。Snapshot 固定绑定 `goalId`、`selectedPlan` 与 `twinVersion`；任何参数或 Twin 版本变化都会使授权失效。`activate_goal` 只激活目标监测，响应明确返回 `autoTransferAuthorized=false`，不会创建自动转账或 Mandate。

响应中的 `telemetry` 包含 token usage、Evidence IDs 和 Feasibility Engine 复核结果。只有 `providerReported=true` 时 token 才代表模型 Provider 的真实消耗；确定性 fallback 返回 0，不应理解为生产环境零成本。
