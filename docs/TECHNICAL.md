# NOVA 技术说明

## 架构与边界

```
React 原版界面 + 对话工作台 ── same-origin /api ── Express 服务
                                   ├─ Zod 共享契约 / 白名单卡片
                                   ├─ 确定性目标与风险规则
                                   ├─ DeepSeek 可选解析 / 编排
                                   ├─ 模拟连接器、幂等同步批次与数据来源证明
                                   ├─ SQLite Thread、Turn、Component、Action、Twin 与审计
                                   └─ 受保护 /mcp 模拟工具
```

- 入口：`server/index.ts`。演示默认时钟为 `2026-09-21`；重置恢复固定夹具。
- 状态：`server/store.ts` 为每个签名 Cookie 建立独立 SQLite 会话。版本化 Financial Twin 包含账户、交易、账单、订阅、目标和 Mandate；写入在 SQLite 事务内同步状态与证据表。
- 契约：`shared/contracts.ts` 使用 Zod；金额均为整数分，日期是 `YYYY-MM-DD`。页面只把分转换为显示用元。
- 规则：`server/domain.ts` 计算资金余量、预测日期和三方案；`server/risk.ts` 统一分析流水趋势、目标影响、用户提醒和外部 Agent 决策；`server/banking.ts` 是统一工具运行时，覆盖目标状态、转账、换汇、Mandate、外部请求、幂等、Operation、Receipt 和审计导出。受保护应急金不进入可用余额。
- 数据连接：`server/data-connections.ts` 提供银行卡、微信支付和支付宝确定性模拟连接器。外部流水按体验者、来源和外部编号去重；同一事务更新流水、账户、Twin Version、风险判断、活动与审计。客户端在启动、回到前台和每分钟调用幂等 `sync/ensure`。
- 批准：`server/governance.ts` 冻结 action、参数、Twin Version 和过期时间并计算 SHA-256；用户确认后签发短期一次性 Token。参数、版本、期限或消费状态不匹配即拒绝。
- 外部认证：`server/security.ts` 用 HMAC 绑定 Agent ID、会话主体、时间戳、Nonce 和请求体；5 分钟窗口和持久化 Nonce 防止重放。它同时提供 Prompt Injection 检测与本地限流。
- 工作台：`server/workspace.ts` 生成完整 Agent Turn。最近 20 条消息和精简 Twin 状态仅用于意图理解；服务端按白名单组合组件，并为写操作签发绑定会话、Twin Version、期限和幂等键的 `actionId`。
- 模型：`server/agent.ts`、`server/understanding.ts` 与 `server/agent-runner.ts` 调用 DeepSeek Chat Completions。理解环节只接受当前消息的原文片段建议；阶段 4 的任务运行器让模型在受限决策协议中选择只读工具、追问或结束。金额、日期、工具参数和结果引用均由服务端校验；模型不能改变权威计算值、正式状态、Action 或批准。超时、无 Key、无效输出或 Prompt Injection 回退确定性模式。
- 调查与试算：`server/agent-read-tools.ts` 的八种白名单工具绑定服务端会话和任务，结果保存在 `agent_tool_results`；`server/domain.ts:assessCandidateScenario` 使用逐月投入序列计算单个候选的可行性。`search_goal_options` 在硬约束内寻找不同完成日期的固定月存候选，排除首月负缓冲与同日高月存方案，再保存可追溯的候选结果 ID。`stress_test_goal_options` 对当前任务已核验的基线候选批量计算有界压力假设，汇总来源、版本、失效结果与原因。`repair_stressed_goal_option` 在用户允许的月存与日期范围内分别搜索通过同一压力情景的最小调整。工具结果带来源实体、Twin Version、假设与缺口，输入引用须归属当前任务。已支持的一次性额外支出、持续收入下降、持续必要支出上升及单月漏存只做模拟计算，不写入 Financial Twin，也不能直接作为可激活候选。旧版固定三方案不代表自定义候选结果。详见 `docs/AGENT_OPTION_SEARCH.md` 与 `docs/AGENT_STRESS_CALCULATOR.md`。
- 自主任务：`server/agent-runner.ts` 在每次模型决策和工具调用后持久化步骤；单次运行最多 6 次决策、12 次工具调用和 45 秒。运行绑定任务修订、演示 Run 和 Twin Version，并使用数据库租约防止并行领取；新消息、取消、旧版本或过期会终止旧运行。候选卡片只接受当前任务已验证的试算结果。工作台可查看进度、刷新恢复与取消运行；Agent API 禁止缓存。
- 候选应用：工作台从最新运行推荐的只读结果生成冻结 Action，绑定任务修订、候选哈希、Twin Version、期限和幂等键。单独确认后，内部 `apply_goal_candidate` 工具消费 Approval，原子激活精确的自定义目标并核对正式状态；它不在公开工具列表或 MCP 中。主目标指针随之切换，余额、应急金和 Mandate 保持原值，监测需另行启用。
- 目标监测：用户明确启用后，`persistStateChange` 在财务状态事务中为活跃订阅写入 `monitor_events`。`server/monitor-worker.ts` 定期原子领取、使用 30 秒租约和最多 3 次退避重试；重启后可接管过期租约。确定性风险筛查先过滤安静变化，再调用白名单只读工具核查证据和修复试算。通知与事件完成状态在同一事务中保存，并按风险信号去重。静默时段按 Asia/Shanghai 的真实时间延后，奖金跟进按 Demo Clock 到期且需要单独启用。修复候选仍回到阶段 5 的独立确认链路。
- 历史：每个体验者可拥有多个长期会话。显著支出按 Impact ID 去重创建未读风险会话；重置演示会轮换 Run ID，并将旧会话转为只读。
- MCP：`server/mcp.ts` 使用 TypeScript SDK Streamable HTTP，只暴露读取、预测、模拟请求和状态查询；它不能创建 Mandate、确认自己的 Approval 或直接写审计。

## 三条链路与状态矩阵

| 场景 | 输入 | 规则结果 | 页面/记录 |
| --- | --- | --- | --- |
| 创建目标 | 描述、金额、日期、保护额 | 草案；未连接时先读取近 90 天模拟流水 | 创建页 → 数据连接 → 可行性页 |
| 方案未选 | 激活 `null` | `PLAN_NOT_SELECTED` | 不激活 |
| 正常 | 可用月结余足够、历史数据 ≥2 月 | `on_track` | 首页按时预测 |
| 数据不足 | 历史数据 <2 月 | `insufficient_data` | 表明依据不足 |
| 不可行 | 目标所需月存高于可用额 | `infeasible` | 禁止不可行方案激活 |
| 小额波动 | 低于趋势证据或目标参考线 | `silent` | 首页无紧急提醒 |
| 趋势但目标未越界 | ≥3 笔、增长 ≥25%、增加 ≥¥200 | `weekly_summary` | 进入周摘要 |
| 累计趋势影响目标 | ¥600 基线升至 ¥1,900，延期 16 天 | `immediate_signal` | 风险会话与影响页 |
| 显著单笔支出 | 超过参考线且目标状态变差 | `immediate_signal` | 影响页，保护额不变 |
| 模型不可用 | 无 Key、超时或无效 JSON | 确定性回退 | 演示不中断 |
| 已授权同类请求 | 身份、额度、余额、期限均合格 | Execute | 模拟余额变动及凭证 |
| 异类但在额度内 | 已授权且需逐次同意 | Ask | 用户核对后确认 |
| 超限/身份不符/余额不足/过期 | 风险或权限不合格 | Block | 无余额变动，审计 |
| 重复请求 | 相同幂等键与参数 | 返回原凭证 | 不重复扣款 |
| 工具超时 | 模拟状态未知 | Unknown | 查询原操作，不重试扣款 |

## 目标感知风险引擎

`Pattern Analyzer` 使用当前 30 天与前两个完整 30 天窗口的平均值比较同类支出。至少 3 笔、增长至少 25%、绝对增加至少 ¥200 才形成趋势证据。用户参考线默认为 ¥500 或目标剩余金额的 5%；参考线只触发进一步评估，最终是否即时提醒仍由目标日期、安全缓冲、数据新鲜度和分类置信度决定。

用户流水只产生 `silent / weekly_summary / immediate_signal`，不会返回拦截结果。历史不足两个月、数据过期或分类置信度不足时，最多进入周摘要。相同 `suppressionKey` 只保存一个信号；稍后或忽略后，底层事实不变不会再次提醒。

Agent 请求按固定顺序判断：身份、有效期、余额、保护资金或硬额度失败先 `Block`；可安全逐次确认的参数不匹配为 `Ask`；达到单笔额度 80% 或额度内操作会使目标变差为 `Manual Review`；全部匹配且不影响目标或安全资金才 `Execute`。DeepSeek 不参与这些金额与执行决策。

## 核心 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/session` | 当前会话完整快照与经过服务端校验的卡片 |
| `POST /api/agent` | 结构化意图、计划、模型来源、回退原因与工具结果 |
| `GET/POST /api/agent/threads` | 查询或创建长期任务会话 |
| `PATCH/DELETE /api/agent/threads/:id` | 重命名、归档、恢复或删除会话 |
| `GET /api/agent/threads/:id/messages` | 读取已校验的消息与生成组件 |
| `POST /api/agent/turn` | 自然语言输入 → 意图 → 服务端受控组件 |
| `POST /api/agent/candidate/select` | 将已验证候选冻结为待用户确认的 Action |
| `GET /api/agent/threads/:id/monitoring` | 读取目标监测状态 |
| `POST /api/agent/monitoring` | 明确启用或暂停目标监测 |
| `POST /api/agent/followup` | 明确安排奖金核对，不预先计入收入 |
| `GET /api/agent/threads/:id/run` | 读取当前任务运行状态与已保存步骤 |
| `POST /api/agent/threads/:id/run/cancel` | 取消当前任务运行 |
| `POST /api/agent/action` | 确认或取消服务端绑定的写操作 |
| `GET/POST /api/financial-twin` | 读取版本化 Twin 或调用统一模拟工具 |
| `GET/POST /api/goal-flow` | 读取目标状态机或执行目标迁移 |
| `GET/POST /api/banking-tools` | 工具发现与第一方调用 |
| `GET /api/activity`, `/api/audit/export` | Hash 链活动与 JSON/CSV 证据 |
| `GET/PATCH /api/risk/preferences` | 读取或更新会话内智能守护偏好 |
| `GET /api/risk/signals` | 读取趋势证据和目标影响信号 |
| `GET /api/data-connections` | 查看模拟来源、权限、覆盖范围与更新时间 |
| `POST /api/data-connections/connect` | 连接选定来源并立即导入近 90 天数据 |
| `POST /api/data-connections/sync/ensure` | 幂等补齐模拟时钟对应的新批次并运行自动守护 |
| `POST /api/data-connections/:source/revoke` | 停止该来源未来同步并保留历史证据 |
| `POST /api/external-agent/request` | HMAC、时间戳、Nonce 认证的外部请求 |
| `POST /api/goal/interpret` | DeepSeek 或确定性自然语言解析 |
| `POST /api/goals`, `PATCH /api/goals/current` | 新建、修改目标草案 |
| `POST /api/goals/activate` | 明确选择后激活方案 |
| `POST /api/impact/decision` | 选择 A/B、稍后或忽略 |
| `POST /api/mandates`, `/api/mandates/revoke` | 创建、撤销模拟授权 |
| `POST /api/demo/agent-request` | 演示外部 Agent 请求 |
| `POST /api/operations/:id/approve`, `GET /api/operations/:id` | 逐次同意与查验 |
| `POST /api/demo/clock`, `/api/demo/reset` | 推进确定性演示时钟或清除目标、连接与模拟财务数据 |
| `GET /api/ui/cards` | 可选模型重排白名单卡片 |
| `GET /api/health` | 健康检查 |

HTTP 写入默认检查 Origin，浏览器 Cookie 为 HttpOnly、SameSite=Lax，生产环境加 Secure。服务按 IP/入口做本地限流，结构化日志不记录正文、Key、签名或完整账户标识。MCP 使用独立 Bearer 令牌绑定同一模拟会话。

## 阶段 7 验证分层

`npm test` 验证确定性计算、状态、安全与脚本化决策协议；`server/agent-acceptance.test.ts` 串联目标调整、确认应用、显著变化和修复确认。`npm run eval:agent:real` 是独立 opt-in 的真实 DeepSeek 多轮只读调查评测，默认跳过、最多 24 次模型决策，不属于离线 CI。具体场景、指标、通过与跳过项见 `docs/AGENT_EVALUATION_REPORT.md`。脚本化模型通过不代表真实模型任务完成率。

## 项目来源与版本

原版视觉来源：本仓库 `main@805a0f6`。本分支不合并旧 PR #1。经双方授权，后端能力与测试场景选择性参考 `Amy-Lin365/NOVA-AI-Banking-Agent@ca1124c` 的契约、状态机、安全规则和测试思想，并在 Express、TypeScript、SQLite 上重新实现。`PRODUCT.md` 使用 DeepSeek 作为可选解释模型。
