# NOVA Agent 分阶段实施记录

更新日期：2026-10-21。依据 `PRODUCT.md`、`AGENTS.md` 和用户提供的《NOVA Agent 分阶段开发提示词》（2026-10-20 重写版）。阶段 0 至 7 的离线实现与验收已完成；真实模型质量评测须单独启用。

## 阶段状态

| 阶段 | 状态 | 下一阶段入口 |
| --- | --- | --- |
| 0 基线 | 已核对 | 使用下述现有草案、会话和财务状态边界 |
| 1 任务状态 | 已实现并验证 | 复用任务记录，进入多轮理解与约束修订 |
| 2 多轮理解 | 已实现并验证 | 复用结构化任务事实与约束，进入只读调查和试算 |
| 3 调查与试算 | 已实现并验证 | 阶段 4 已接入结果驱动循环 |
| 4 自主循环 | 已实现并验证 | 阶段 5 已接入候选确认应用链路 |
| 5 确认应用 | 已实现并验证 | 阶段 6 已在明确启用后接入监测 |
| 6 监测修复 | 已实现并验证 | 阶段 7 全链路验收与真实模型评测 |
| 7 全链路验收 | 离线验收已完成；真实模型评测待显式启用 | 见 `docs/AGENT_EVALUATION_REPORT.md` |

## 当前调用链与文件映射

- `server/index.ts` 的 `POST /api/agent/turn` 取服务端会话和当前 DemoState，调用 `server/workspace.ts:createAgentTurn`。`GET/POST /api/agent/threads`、消息、预览和动作 API 也在此注册；`src/api.ts` 调用这些 API，`src/screens/AgentWorkspaceScreen.tsx` 管理消息、线程、预览和确认，`src/components/AgentComponentRenderer.tsx` 渲染服务端白名单组件。
- `createAgentTurn` 先以规则识别意图，再让 `server/agent.ts:interpretAgentRequest` 尝试模型分类；读取同线程最近 20 条消息及精简 Twin 上下文。目标路径由 `server/understanding.ts` 解析当前消息，再由 `mergedGoalDraft` 按逐字段修订语义保存。完整目标会启动 `server/agent-runner.ts` 的受限只读调查循环。`server/deepseek-client.ts` 用服务端环境变量调用 JSON 模式，Schema、超时或无 Key 失败时回退；注入检查在 `server/security.ts`。
- `mergedGoalDraft` 在 `server/workspace.ts` 读取 `getGoalDraft`，只合并明确设置或清除的字段。`GoalDraftSchema` 在 `shared/contracts.ts`；`server/store.ts` 的 `goal_drafts` 按 sessionId、threadId 保存。必需字段为标题、金额和日期。缺字段显示澄清组件，且不会拿演示目标补足；字段齐全时，旧版工作台预览仍默认已存金额为零、月存为可用月额、保护额为演示应急金、弹性为两周。
- `POST /api/agent/preview` 由 `createScenarioPreview` 校验假设和线程，只读调用 `server/scenario.ts:previewGoalScenario`。该旧版入口继续生成固定三方案。阶段 4 循环通过 `server/agent-read-tools.ts` 调用纯计算并生成候选自身的结果和证据，工作台展示已验证的只读候选。`server/banking.ts` 的正式 `activate_goal` 仍只接受固定 `planId`。
- 预览/状态组件可创建 `agent_actions`。`POST /api/agent/action` 经 `executeWorkspaceAction` 核对 action 所属会话、线程、状态、期限和 Twin Version，然后由 `server/banking.ts` / `server/governance.ts` 做批准快照、确认、消费及执行。`server/tools.ts` 另有外部 Agent 模拟请求的授权、风险、执行、验证、审计与设备验证要求。后续须保留这些控制，不允许模型批准自身动作。
- `server/store.ts` 使用 SQLite 保存 DemoState、线程、消息、回合、组件、草案、任务、只读工具结果、动作和审计相关记录。`resetState` 重置演示财务状态并将旧线程归档、设为只读，生成新的 Demo Run；线程可归档或删除。
- `server/risk.ts` 负责现有风险信号/摘要，`server/webauthn.ts` 和 `server/store.ts` 负责设备验证挑战。`src/offline.ts` 与 PWA 配置、`tests/e2e`、`promptfooconfig.yaml`、`scripts/run-promptfoo-eval.mjs` 是现有验证入口。Promptfoo 配置声明为确定性意图与回退评测，不代表真实模型多轮质量。

## 阶段 1：任务状态、约束与恢复

实现文件：`shared/contracts.ts` 定义 `AgentTask`、阶段、事实、硬约束、偏好、未知项、字段来源、候选日期、证据/候选引用与运行摘要；`server/store.ts` 增加 `agent_tasks` SQLite 表、迁移和内部任务 API；`server/agent-task.test.ts` 用独立临时数据库及两个并发进程验证行为。没有新增对外 HTTP API。

关系与归属：

- `Thread` 是会话容器，归属由服务端的 sessionId 决定；当前每个 Thread、Demo Run 最多一个 `AgentTask`。`GoalDraft` 继续保存可编辑目标草案，任务通过 `goalDraftId` 关联它，保存草案时原子创建或修订任务。`Turn`/消息仍记录对话；本阶段没有让 Turn 驱动任务运行。
- `AgentTask` 保存任务阶段、事实与约束及其来源、原始期望日、允许的最晚日期和当前候选日。最晚日期必须不早于原始期望日；候选日不得超过允许范围。草案字段改变会清除旧候选引用、候选日与待确认动作，不累计延后范围。
- `Demo Run` 由 `agent_runs.current_run_id` 表示。任务保存创建时的 `demoRunId`；重置会终止旧任务、归档旧线程并切换 Run。旧任务可按 ID 查看，但派生为只读。归档线程会暂停任务；恢复线程后仍需显式恢复任务；删除线程会连同任务记录一起删除。
- `Twin` 是正式财务状态，`baseTwinVersion` 只是任务创建/重新取证时记录的版本。任务创建、修订、暂停、恢复、取消、归档和删除均不修改财务状态或增加 Twin Version；任务更新若显式提交新的基础版本，必须等于当前 Twin Version。

内部调用：`createAgentTask` / `getAgentTask` / `getAgentTaskForThread` / `updateAgentTask` / `pauseAgentTask` / `resumeAgentTask` / `cancelAgentTask`。`updateAgentTask` 使用任务修订号和 SQLite 原子事务；过期修订、旧 Run、归档线程、非法阶段跳转、越界候选日、跨线程来源消息和越权草案/目标关联均被拒绝。等待阶段只存状态，不维持模型调用。

限制与阶段 2 入口：当前 `interpretGoal` 和 `mergedGoalDraft` 仍按旧规则提取字段；来源消息只对现有已识别字段自动关联，明确清除、否定、中文金额、相对日期和“最多晚两周”的语义修订尚未实现。阶段 2 应在现有理解与草案合并链路中填充/更新 Task 的事实、硬约束、偏好和未知项，并严格区分未提及、清除与修改。证据及候选引用目前只是受限结构，实际归属和存在性校验留待阶段 3 的只读工具注册；没有模型权限或正式执行入口。

## 已知边界与后续约束

### 2026-10-21 阶段 2：多轮理解

- `server/understanding.ts` 识别创建、补充、修改、拒绝、询问、取消和选择意向，输出逐字段 `set`/`clear`/未提及三态。金额转换为整数分，日期按 Demo Clock 转 ISO 并校验；无效日期只追问，不污染已确认草案。中文金额、零值、相对日期、原目标日期起算的“两周”均由确定性代码处理。
- 模型只给意图标签和当前消息的原文片段建议；片段必须逐字出现在当前消息中，金额与日期仍由服务端解析。Schema、超时、缺 Key、注入及无效片段走确定性回退。模型收到同线程最近消息、任务事实和当前消息；不会得到其他会话或正式写工具。
- 工作台回合把已明确的修订写入 `GoalDraft` 和 `AgentTask`，来源关联当前用户消息。可能的奖金保留在未知项；健身支出保留为偏好，未当作月度储蓄或硬约束。拒绝方案清除旧候选，取消任务停止后续规划；“选推荐的”在没有唯一已验证候选时追问，不自动授权或应用。任务内修订不改变 Financial Twin。
- `server/workspace.test.ts` 新增目标多轮对话、中文金额、延后边界、未知奖金、支出偏好、改金额其他不变、选择意向、零值、撤回、无效日期与取消测试。工作台没有视觉改动，因此本阶段未单独运行 UI E2E。

阶段 3 才会建立有来源和有效性校验的只读候选试算；当前旧版三方案预览继续保持原有交互，但不能视为阶段 3 的候选结论。

阶段 2 验证：`npm run lint`、`npm run build`、`git diff --check` 均通过；`npm test` 为 97 项通过、0 项失败。未运行真实 DeepSeek 多轮评测；本轮模型路径仅接受受约束的原文片段建议，回退路径及服务端边界由测试覆盖。

### 2026-10-21 阶段 3：只读调查与候选试算

- `server/agent-read-tools.ts` 建立内部白名单注册表：财务概况、必要账单、相关流水、数据充分性、候选试算。调用方只给工具名和受限参数；会话、任务、Run 与 Twin Version 均由服务端读取。输入与输出契约位于 `shared/contracts.ts`，未知工具、额外字段、非法金额与日期均拒绝。
- `server/store.ts` 新增 `agent_tool_results` 持久表，按会话、线程、Run、状态和参数去重。每条结果包含 ID、版本、数据时间、来源实体、假设、缺口与状态；任务中的证据和候选引用须指向本任务实际存在的结果。目标条件或 Twin Version 改变时，旧候选引用失效。工具记录不进入正式 Twin，不创建 Action、Approval 或资金操作。
- 候选复用 `previewGoalScenario` 的纯计算入口，同时由 `server/domain.ts:assessCandidateScenario` 计算该候选自己的投入、预计日期、缓冲和缺口。预算不能低于用户目标；日期不能超出原日及允许范围；月投入不能越过用户上限或可用能力；保护额不得降低。固定账单、必要支出和应急金从可投入能力中扣除；若保护额高于现有应急金，差额占用活期资金并降低首月能力。
- 支持基础、当月额外支出和月收入下降情景；逐日延薪、汇率变化与概率情景返回 `unsupported`。历史不足或已存金额未确认时不提供确定的预计日期。有限候选失败只说明该候选的约束和计算结果，不能推断全局无解。
- 现阶段工具由内部调用，尚未让模型自主选择或循环调用；该集成属于阶段 4。旧版工作台三方案及其确认链路仍独立，阶段 3 候选没有正式应用入口。

阶段 3 验证：`server/agent-read-tools.test.ts` 覆盖五种工具、候选差异、保护金额对首月能力的实际影响、压力情景、去重、跨会话及伪造来源、非法输入、数据不足、条件或 Twin Version 变化后候选失效，并核对正式 Twin 与 Action 数量不变。`npm test` 为 101 项通过、0 项失败；`npm run lint`、`npm run build` 和 `git diff --check` 通过。没有运行模型自主工具选择或 UI E2E，因为阶段 3 未接入这两条链路。

### 2026-10-21 阶段 4：受控自主调查

- `server/agent-runner.ts` 建立 `tool_call / ask_user / recommend / finish` 决策协议。模型只能选择阶段 3 的白名单只读工具并提交受限参数；每轮结果与错误反馈进入下一轮，决策、工具结果和终态持续写入 `agent_task_runs`。运行上限为 6 次决策、12 次工具调用和 45 秒。
- 数据库领取令牌避免同一运行并发执行；任务修订、Financial Twin Version、Demo Run 与取消状态在异步步骤之间复查。新用户消息会终止旧运行；失效运行不能追加候选答复。无 Key、模型异常或无效输出有确定性调查回退。
- `recommend` 最多接受 3 个候选，每个候选必须引用当前任务、当前版本的真实 `candidate_preview` 工具结果；无效引用、重复结果或越界工具会被拒绝。阶段 4 候选仅展示试算证据，不自动创建正式目标、Action 或 Approval。
- 工作台显示运行状态、步骤摘要、停止按钮与受验证的候选卡片；刷新后从服务端恢复运行。新增状态与取消 API，Agent API 和 PWA 请求禁用敏感缓存。原版布局、导航、配色和手机框保持。
- 脚本化模型测试覆盖“查询→试算失败→修订→推荐”、基于结果分支、并发、新消息与取消、预算截止、非法/重复调用、伪造候选、无 Key 回退；这些测试验证协议行为，不代表真实 DeepSeek 的质量评测。旧版固定三方案仍保留为独立手动路径，尚未把阶段 4 候选接入阶段 5 的应用链路。
- 阶段 4 验证：`npm test` 107 项通过、0 项失败；`npm run lint`、`npm run build`、`git diff --check` 通过。新增运行状态/刷新/横向溢出测试在 360、768、1440 三种宽度通过；已有首次使用测试在三种宽度通过，平板周摘要回归通过。HTTP 测试需允许本机服务端口，限制环境中的首次全量尝试有 3 项服务启动失败，允许本机端口后全量复跑通过。未接入真实 DeepSeek Key 做开放式质量评测。

### 2026-10-21 阶段 5：候选确认与正式应用

- 只有最新运行真正推荐、归属当前任务且 Twin Version 一致的基础情景候选可进入确认。服务端冻结候选哈希、目标字段、任务修订、Demo Run、Twin Version、到期时间和幂等键；客户端只提交候选结果 ID，不能提交生效参数。自然语言“选推荐的”只有唯一候选时才生成确认卡，多候选时要求具体选择。
- 确认卡逐项展示目标金额、日期、每月投入、保护资金和激活效果。确认前不修改财务状态。自定义候选走独立内部工具 `apply_goal_candidate`，不会伪装成固定三方案 `planId`，也不向公开工具注册表或 MCP 暴露；Action 确认后复用 Approval 快照、Token 消费和 Hash 链审计。
- 正式目标、主目标指针和 Twin Version 在单次状态事务中更新。执行后将正式目标与冻结内容逐项比较，并核对余额、应急金和 Mandate 未改变，才生成成功回执。回执不引用无关历史 Operation。旧修订、旧 Twin、跨会话与重复确认均受校验；事务失败不留下部分财务写入，重复确认读取原动作结果。任务最终状态可以在动作提交后或重放时恢复。
- 激活目标不自动扣款、不创建 Mandate、不启用阶段 6 的后台监测。阶段 5 验证包括候选确认前后状态、幂等、跨会话、版本与任务修订失效、内部工具权限，以及手机界面的确认流程；真实模型开放式评测仍未执行。
- 阶段 5 验证：`npm test` 111 项通过、0 项失败；`npm run lint`、`npm run build` 和 `git diff --check` 通过；360 宽度的候选选择、单独确认、主目标切换 UI 测试通过。

### 2026-10-21 阶段 6：持久监测与修复建议

- `monitor_subscriptions` 保存用户明确开启的目标监测；`monitor_events` 在财务版本更新的同一 SQLite 事务中入队，记录会话、任务、Demo Run、目标、版本、到期时间及去重键。内置 worker 以数据库租约领取，租约超时可由重启后的进程接管，失败最多重试 3 次并退避。通知正文、组件、去重记录和事件完成状态在一个事务中提交。
- 确定性规则先筛查现有显著风险信号；低价值变化不调用模型或试算。显著影响调用只读概况、流水和候选试算，通知提供变化、来源证据、目标影响、假设、修复建议与下一步。能验证的候选只是未生效试算，仍走阶段 5 的冻结确认。暂无合规候选时明确说明当前约束下未找到方案，不声称全局无解。
- 静默时段按 Asia/Shanghai 真实时间延后；财务日期、奖金跟进到期按 Demo Clock。奖金跟进须单独点击安排，到期只询问实际到账情况。暂停、归档、删除、演示重置、旧 Run、目标不再活跃或过期 Twin 均阻止旧事件送达。当前仅有应用内风险/任务会话触达，浏览器关闭后依赖服务进程持续运行。
- 验证覆盖无影响安静、显著影响的一次通知和真实候选引用、重复事件、竞争领取、租约过期跨进程重启、静默与暂停、演示日期到期、归档/删除/重置失效。尚未运行真实 DeepSeek 多轮监测质量评测；该项留待阶段 7。
- 阶段 6 验证：`npm test` 118 项通过、0 项失败；`npm run lint`、`npm run build` 与 `git diff --check` 通过；手机宽度的明确启用、奖金跟进、刷新恢复流程通过。

### 2026-10-21 阶段 7：整体验收与评测入口

- 新增 `server/agent-acceptance.test.ts`，以隔离模拟会话串联只读调查、用户修改、再试算、单独确认、启用监测、显著变化、只读修复和再次确认。`scripts/run-agent-model-eval.ts` 提供显式 opt-in、总调用上限 24 次、四类隔离场景与结构化指标；默认不联网且输出 `skipped`。真实模型质量仍未运行，不能将脚本化结果冒充模型成绩。
- `docs/AGENT_EVALUATION_REPORT.md` 将确定性测试、脚本化编排、真实模型评测分开记录；没有同场景旧版基线，不报告提升百分比。`docs/DEFENSE_OUTLINE.md` 与部署说明补充完整演示路径及限制。
- 本轮 `npm test` 119/119、`npm run test:properties` 5/5、`npm run test:e2e` 72/72（含无障碍）、`npm run lint`、`npm run build` 与 `git diff --check` 通过。`npm run eval:agent:real` 返回 `skipped: opt_in_required`。Promptfoo 临时工具取得/执行超过 120 秒，未得到成功结果，详见评测报告。

### 2026-10-22 已存金额追问修复

- 完整目标若未确认已存金额，普通方案卡明确标注暂按 0 元试算，工作台追问真实已存额；若模拟历史不足 2 个月，提示先补模拟数据。两种情况均不启动会产生 `insufficient_data` 结果的自主调查。确认金额及数据充足后才启动只读调查。
- 新增服务端与手机端回归；`npm test` 120/120、`npm run lint`、`npm run build`、`git diff --check` 通过，截图对应手机流程单项通过。阶段 7 先前 72/72 跨尺寸界面结果属于修复前全量记录，本次仅运行受影响手机流程。

阶段 0 曾记录的多轮语义、候选来源和任务持久化缺口已分别由阶段 1—4 处理。仍适用的预测边界是月度汇总现金流与有限历史；任意候选必须以自身只读试算结果为证据，保护资金须进入实际可用能力计算。模型仅能建议未生效参数，不能覆盖权威计算或正式写操作。

## 验证记录

本轮开始时 `git status --short --branch` 为 `main...origin/main`，无已有未提交改动。随后目录中出现用户新增的阶段提示词和技能推荐文件；本轮未改动它们。依赖声明见 `package.json`；未读取或输出密钥。

| 命令 | 本轮结果 |
| --- | --- |
| `npm run lint` | 未运行到类型检查：本地缺 `tsc`，退出码 1 |
| `npm test` | 未运行到测试：本地缺 `tsx`，退出码 1 |
| `npm run build` | 未运行到构建：本地缺 `vite`，退出码 1 |
| `npm ci --no-audit --no-fund` | 安装失败，npm 报 `Exit handler never called!`；未取得可用依赖 |
| 工作台 E2E | 未运行：依赖未安装，Playwright 启动条件不具备 |

以上为 2026-10-20 首次运行结果，不能作为代码通过或失败的证据。

### 2026-10-21 依赖恢复与复测

- Node.js `v24.15.0` 符合项目要求。当前 npm `11.12.1` 的 `npm ci` 在此环境报 `Exit handler never called!` 或长时间停滞；沙箱内 npm 仓库 DNS 不可用。使用已安装的 pnpm `12.14.0` 从现有 `package-lock.json` 临时导入锁文件，在允许联网的环境中安装 517 个依赖；未改 `package.json` 或 `package-lock.json`。临时 pnpm 锁文件随后移除。
- `npm run lint`：通过，退出码 0。
- `npm test`：93 项通过、0 项失败，退出码 0。三项 HTTP 测试需允许本机端口的运行环境；修正了 Windows 下直接执行 `node_modules/.bin/tsx` 和子进程退出前清理 SQLite 临时目录的问题，并延长慢速机器的服务就绪等待。
- `npm run build`：通过，退出码 0；PWA service worker 已生成。
- 工作台 E2E 仍未运行；阶段 0 的主要基线命令已恢复，界面验收可在后续涉及界面时执行。

### 2026-10-21 阶段 1 验证

在 `codex/agent-task-state` 分支完成。`server/agent-task.test.ts` 使用独立临时 SQLite 数据库，并让两个进程同时提交同一任务修订：只有一个成功。测试还覆盖跨进程恢复、旧数据库增量建表、会话隔离、日期范围、暂停/恢复、归档、删除、取消、演示重置、旧 Run 只读，以及任务写入前后财务状态不变。

| 命令 | 结果 |
| --- | --- |
| `npm run lint` | 通过，退出码 0 |
| `npm test` | 95 项通过、0 项失败，退出码 0；HTTP 集成测试在允许本机端口的环境运行 |
| `npm run build` | 通过，退出码 0；PWA service worker 已生成 |
| `git diff --check` | 通过，退出码 0 |
| 工作台 E2E | 未运行；本阶段没有界面改动 |

本阶段未运行真实 DeepSeek 多轮评测，也不将脚本化状态测试算作模型自主能力验证。
