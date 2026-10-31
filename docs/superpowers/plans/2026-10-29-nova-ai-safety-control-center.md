# NOVA AI Safety Control Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在已完成的 A 部分之上，交付一套评委可见、可操作、可验证的 AI 安全控制中心，包括 AI 安全护照、应用级 Safe Mode、结构化决策回执和红队评测成绩单。

**Architecture:** 先把现有 Skill 权限、Agent 运行、审计链和评测结果整理成严格的共享契约，再增加只读安全总览接口与应用级安全控制。Safe Mode 必须由服务端持久化并真正阻断外部模型调用和 AI 发起的写操作；前端只展示服务端状态，不能自行推断或伪造“已防护”。红队评测采用确定性套件作为发布门槛，真实 DeepSeek 评测单独报告。

**Tech Stack:** TypeScript 7、Node.js 22、React 19、Express 4、SQLite、Zod 4、Tailwind CSS 4、Node test runner、Playwright、Promptfoo。

**Spec:** `docs/superpowers/specs/2026-10-26-nova-v0.6-deepening-design.md`；安全控制依据为《银行业保险业人工智能安全开发应用指导意见》第 15–26 条以及 `docs/SECURITY_SELF_ASSESSMENT.md` 中已声明的产品边界。

## 执行前提

- A 部分最终提交必须先合入共同集成分支；本计划从该提交新建 `feature/nova-v06-ai-safety`，不从旧的 B 分支直接叠加。
- 开始前运行 `git status --short`，必须为空；记录基线提交哈希。
- 本计划由一位负责人完成整个 AI Safety 纵向功能，因此可以修改 `shared/**`、`server/**`、`evals/**`、`scripts/**`、`src/**`、`tests/e2e/**` 和交付文档。
- 不重写已经验收的余额、现金流、订阅、转账、授权、审计链或 Money Mission 业务语义。
- 如果基线已有同名功能，扩展现有实现，不复制第二套状态或第二套计算逻辑。

## Global Constraints

- NOVA 仍是模拟金融产品，界面和文档只能表述“产品级控制与指导意见一致”，不得宣称银行保险机构层面的整体合规、备案或认证。
- AI 始终只能路由、询问、解释和准备候选项；`canExecuteAction` 必须保持 `false`，任何资金或权益写操作仍需不可变确认、风险复核、验证、回执和审计。
- Safe Mode 开启后必须：阻断新的外部模型调用、停止所有正在运行的 Agent、阻断 AI 已准备但尚未确认的写操作；确定性只读功能、查看历史回执和用户取消操作仍可用。
- Safe Mode 不得只存在于 React state；状态必须由服务端持久化，刷新和服务重启后仍然有效。
- 生产环境默认隐藏 Safe Mode 的演示开关；只有 `NOVA_ENABLE_DEMO_CONTROLS=true` 时才允许通过演示接口切换。安全状态本身始终可读。
- 不保存或展示模型隐藏思维链。所谓“决策路径”只能包含结构化事实：模型/降级来源、Skill、工具名、证据引用、规则结果、人审状态、Twin Version 和最终结果。
- 原始账单行、交易原文、完整账号、文件名或文件字节、Cookie、API Key、Approval token、用户完整提示词和恶意测试全文不得进入安全总览、决策回执、分析事件或评测成绩单。
- 确定性评测和真实模型评测必须分开报告；没有 `DEEPSEEK_API_KEY` 时可以跳过真实模型评测，但不得把 Mock 或规则结果标成真实模型结果。
- 评测报告缺失、过期或解析失败时，界面显示“尚未验证”，不得显示通过。
- 所有安全状态必须同时使用文字和图标，不能只依赖颜色；键盘、焦点恢复、Reduced Motion 和 WCAG AA 必须通过。
- 360、768、1440 三个宽度均需验收；不得破坏现有手机框架、青绿色视觉和 Governed Canvas。
- 不新增运行时依赖，除非现有工具无法生成必需结果；若确需新增，先说明原因并让 `npm audit --audit-level=high` 通过。

## Review Focus

- Safe Mode 在 Agent 运行中途开启：运行必须转为 `cancelled`，之后不能产生候选写操作或部分写入；Task 2 覆盖。
- Safe Mode 开启前生成的确认卡：即使 Approval 尚未过期，确认也必须返回 `AI_SAFE_MODE_WRITE_BLOCKED`，取消仍然成功；Task 2 覆盖。
- 评测报告缺失、损坏或 suiteVersion 过旧：API 和 UI 必须显示 `unavailable`，不能沿用旧的绿色通过状态；Task 4、Task 5 覆盖。
- 跨会话读取决策回执：必须返回 `AI_SAFETY_RECEIPT_NOT_FOUND`，不能泄漏另一会话的 run、thread、证据或工具记录；Task 3 覆盖。
- 安全证据中的敏感字段：原始提示词、交易描述、账号、令牌、Cookie、密钥和文件信息必须被契约拒绝或完全不查询；Task 3、Task 4 覆盖。

---

## 文件结构与职责

### 共享契约

- `shared/contracts.ts`：AI 安全状态、Skill 护照、评测摘要、决策回执及总览响应的唯一 Zod 契约。

### 服务端

- `server/ai-safety.ts`：从现有 Skill registry、控制状态、评测报告和会话数据构造只读安全总览。
- `server/ai-safety.test.ts`：护照、总览、报告失效和敏感字段边界测试。
- `server/ai-safety-control.ts`：持久化 Safe Mode、模型/写操作 guard、停止活动 Agent。
- `server/ai-safety-control.test.ts`：重启恢复、中途急停、旧确认阻断、只读降级测试。
- `server/ai-safety-receipt.ts`：按当前会话构造结构化 Agent 决策回执。
- `server/ai-safety-receipt.test.ts`：会话隔离、字段最小化和审计状态测试。
- `server/store.ts`：只增加安全控制和回执所需的持久化/只读查询，不改变既有业务表语义。
- `server/index.ts`：注册只读安全 API 和受环境变量保护的演示切换 API。
- `server/deepseek-client.ts`、`server/agent-runner.ts`、`server/workspace.ts`：接入 Safe Mode guard；不得复制业务判断。

### 评测

- `evals/ai-safety-cases.json`：30 个去敏后的确定性攻击用例及期望控制。
- `scripts/run-ai-safety-eval.ts`：运行评测、校验结果并生成机器可读报告。
- `evals/reports/ai-safety-latest.json`：最近一次确定性发布证据，只包含 case ID、分类、结果和控制代码。
- `package.json`：增加 `eval:ai-safety`，不得删除或弱化现有脚本。

### 产品界面

- `src/screens/AISafetyScreen.tsx`：用户可见的 AI 安全控制中心，只消费安全总览 API。
- `src/components/ai-safety/SafetyModeBanner.tsx`：展示当前安全模式及其实际效果。
- `src/components/ai-safety/SafetyPassportCard.tsx`：展示每个 Skill 的能力边界、风险级别、人审和降级路径。
- `src/components/ai-safety/SafetyScorecard.tsx`：展示红队类别成绩和报告时效。
- `src/components/ai-safety/DecisionReceiptCard.tsx`：展示结构化决策路径，不显示隐藏推理。
- `src/screens/DemoControlScreen.tsx`：仅在服务端返回 `demoControlsEnabled=true` 时提供 Safe Mode 演示开关。
- `src/types/index.ts`、`src/App.tsx`、`src/screens/ProfileScreen.tsx`：增加安全中心路由和入口。

### 验收与交付

- `tests/e2e/ai-safety.spec.ts`：端到端、安全模式和会话隔离验收。
- `tests/e2e/money-mission-accessibility.spec.ts`：安全中心三宽度、键盘与无障碍验收。
- `docs/AI_SAFETY_CASE.md`：评委可读的控制目标→代码控制→测试证据映射。
- `DEMO_SCRIPT.md`：增加不超过 90 秒的 AI 安全演示段。
- `README.md`、`PRODUCT.md`、`docs/AGENT_IMPLEMENTATION_STATUS.md`、`docs/SECURITY_SELF_ASSESSMENT.md`：更新真实实现状态和残余风险。

---

### Task 1: 冻结 AI 安全契约与 Skill 安全护照

**Files:**
- Modify: `shared/contracts.ts`
- Create: `server/ai-safety.ts`
- Create: `server/ai-safety.test.ts`

**Interfaces:**
- Consumes: `listSkillDefinitions()` from `server/skills/registry.ts`。
- Produces: `AiSafetyControlSchema`、`AiSafetyPassportSchema`。
- Produces: `buildSkillSafetyPassports(): AiSafetyPassport[]`。

- [ ] **Step 1: 在 `server/ai-safety.test.ts` 写失败测试**

测试必须断言：

1. 返回恰好 10 张 Skill 护照，其中 8 张 `enabled=true`，Skills 6–7 为 `p1_stretch` 且禁用。
2. 每张护照的 `canExecuteAction` 都严格为 `false`。
3. `riskClass=prepare_write` 时 `humanReview='required_before_write'`；只读 Skill 为 `not_applicable`。
4. 护照只暴露 `allowedToolCount`，不暴露输入/输出 Schema、工具参数或授权数据。
5. 所有护照声明 `requiresEvidence`、`maxToolCalls`、`timeoutMs` 和 `fallbackMode='deterministic_read_only'`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --import tsx --test server/ai-safety.test.ts`

Expected: FAIL，原因是安全契约或 `buildSkillSafetyPassports` 尚不存在。

- [ ] **Step 3: 在 `shared/contracts.ts` 定义严格契约**

使用以下稳定字段，所有对象 `.strict()`：

```ts
AiSafetyControl = {
  mode: 'normal' | 'safe_mode';
  activatedAt: string | null;
  reasonCode: 'manual_demo' | 'provider_incident' | 'evaluation_gate_failed' | null;
  modelCallsAllowed: boolean;
  aiWriteActionsAllowed: boolean;
  deterministicReadOnlyAvailable: true;
}

AiSafetyPassport = {
  skillId: SkillId;
  version: string;
  release: 'p0' | 'p1_stretch';
  enabled: boolean;
  riskClass: 'read' | 'recommend' | 'prepare_write' | 'write';
  canPrepareAction: boolean;
  canExecuteAction: false;
  allowedToolCount: number;
  maxToolCalls: number;
  timeoutMs: number;
  requiresEvidence: boolean;
  humanReview: 'required_before_write' | 'not_applicable';
  fallbackMode: 'deterministic_read_only';
}
```

`AiSafetyDecisionReceiptSchema` 由 Task 3 定义，`AiSafetyEvaluationSummarySchema` 和 `AiSafetyOverviewSchema` 由 Task 4 定义。不得提前创建宽松占位 Schema。

- [ ] **Step 4: 实现 `buildSkillSafetyPassports()`**

只从 `listSkillDefinitions()` 映射；不得维护第二份 Skill 权限清单。

- [ ] **Step 5: 运行聚焦测试和 registry 回归测试**

Run: `node --import tsx --test server/ai-safety.test.ts server/skills/registry.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add shared/contracts.ts server/ai-safety.ts server/ai-safety.test.ts
git commit -m "feat: add AI safety passport contracts"
```

---

### Task 2: 实现持久化 Safe Mode 与服务端强制阻断

**Files:**
- Create: `server/ai-safety-control.ts`
- Create: `server/ai-safety-control.test.ts`
- Modify: `server/store.ts`
- Modify: `server/deepseek-client.ts`
- Modify: `server/agent-runner.ts`
- Modify: `server/workspace.ts`
- Modify: `server/index.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `AiSafetyControl` from Task 1。
- Produces: `getAiSafetyControl(): AiSafetyControl`。
- Produces: `setAiSafetyMode(actorSessionId: string, input: { enabled: boolean; reasonCode: AiSafetyReasonCode }): AiSafetyControl`。
- Produces: `externalModelCallsAllowed(): boolean` 和 `assertAiWriteAllowed(): void`。
- Produces: `GET /api/ai-safety/control`。
- Produces: `POST /api/demo/ai-safety/safe-mode`，请求体严格为 `{ enabled: boolean, reasonCode: 'manual_demo' }`。

- [ ] **Step 1: 写 Safe Mode 失败测试**

在 `server/ai-safety-control.test.ts` 覆盖：

1. 默认状态为 `normal`，确定性只读始终可用。
2. 开启后写入 SQLite；重新导入模块/重新打开数据库后仍为 `safe_mode`。
3. 开启时，所有 `running` Agent run 转为 `cancelled`，reasonCode 为 `AI_SAFE_MODE`。
4. 新的 DeepSeek 选择调用不得发出网络请求，直接返回确定性降级原因 `AI_SAFE_MODE`。
5. 开启前已经生成的 Agent 确认动作，再点击确认必须抛出 `AI_SAFE_MODE_WRITE_BLOCKED`，且 Twin、余额、目标存款和操作数不变。
6. 相同动作选择取消仍然成功。
7. 只读 `/api/session`、`/api/money-mission`、安全护照和历史回执仍可读取。
8. 演示开关在 `NOVA_ENABLE_DEMO_CONTROLS` 未启用时返回 404，不得仅靠前端隐藏。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --import tsx --test server/ai-safety-control.test.ts`

Expected: FAIL，原因是控制表、guard 和路由尚不存在。

- [ ] **Step 3: 在 `server/store.ts` 增加单例控制表与查询**

新增 `ai_safety_control` 单例记录，只保存模式、原因和时间。增加一次性事务函数，把所有活动 Agent run 标记为 `cancelled`；不要修改业务状态或删除记录。

- [ ] **Step 4: 实现 `server/ai-safety-control.ts`**

`setAiSafetyMode(actorSessionId, { enabled: true })` 必须先持久化，再取消活动运行，最后向触发切换的会话追加不含敏感内容的哈希链审计事件。重复开启/解除必须幂等；不得把全局控制记录复制到每个会话。

- [ ] **Step 5: 接入模型和 AI 写操作 guard**

- `server/deepseek-client.ts`：Safe Mode 下不访问 DeepSeek，使用现有确定性降级路径。
- `server/agent-runner.ts`：每次模型决策和工具调用前检查模式；中途切换时安全停止。
- `server/workspace.ts`：在确认 AI 生成的写动作前调用 `assertAiWriteAllowed()`；取消动作不受阻断。
- 不拦截普通只读查询，也不把 Safe Mode 变成第二套权限系统。

- [ ] **Step 6: 注册接口与环境边界**

`GET /api/ai-safety/control` 始终可用并设置 `Cache-Control: no-store`。`POST /api/demo/ai-safety/safe-mode` 只有显式启用演示控制时存在；`.env.example` 默认 `NOVA_ENABLE_DEMO_CONTROLS=false`。

- [ ] **Step 7: 运行聚焦回归测试**

Run: `node --import tsx --test server/ai-safety-control.test.ts server/agent-runner.test.ts server/workspace.test.ts server/tools.test.ts server/properties.test.ts`

Expected: PASS，且 Safe Mode 测试证明没有部分写入。

- [ ] **Step 8: 提交**

```bash
git add server/ai-safety-control.ts server/ai-safety-control.test.ts server/store.ts server/deepseek-client.ts server/agent-runner.ts server/workspace.ts server/index.ts .env.example
git commit -m "feat: add persistent AI safe mode"
```

---

### Task 3: 增加会话隔离的 AI 决策回执

**Files:**
- Create: `server/ai-safety-receipt.ts`
- Create: `server/ai-safety-receipt.test.ts`
- Modify: `shared/contracts.ts`
- Modify: `server/store.ts`
- Modify: `server/index.ts`

**Interfaces:**
- Consumes: 现有 `AgentRun`、`AgentTask`、`agent_turns`、`agent_tool_results`、审批摘要和审计链验证结果。
- Produces: `buildAiSafetyDecisionReceipt(sessionId: string, runId: string): AiSafetyDecisionReceipt`。
- Produces: `GET /api/ai-safety/runs/:runId/receipt`。

- [ ] **Step 1: 写回执失败测试**

断言回执只包含：

- `runId`、`status`、`provider`、`fallbackReason`、`skillId`；如果该次运行没有记录到 Skill，`skillId` 必须为 `null`，不得按阶段猜测；
- `decisionCount`、`toolCallCount`、工具名与成功/失败状态；
- 证据 ID、Twin Version、是否需要人工确认及确认状态；
- `auditChainValid`、`startedAt`、`completedAt`。

同时断言序列化结果不包含：`prompt`、`message`、`content`、`reasoning`、`chainOfThought`、交易标题、账号、Cookie、token、API key、文件名或文件字节。

增加跨会话测试：会话 B 请求会话 A 的 runId 必须抛出 `AI_SAFETY_RECEIPT_NOT_FOUND`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --import tsx --test server/ai-safety-receipt.test.ts`

Expected: FAIL，原因是查询和回执构造器不存在。

- [ ] **Step 3: 完成 `AiSafetyDecisionReceiptSchema`**

Schema 必须 `.strict()`；`provider` 只允许 `deepseek | deterministic | null`，`skillId` 使用 `SkillIdSchema.nullable()`，人审状态只允许 `not_required | awaiting_confirmation | confirmed | cancelled | blocked`。

- [ ] **Step 4: 在 `server/store.ts` 增加会话约束的只读查询**

每条查询同时使用 `session_id` 和 `run_id`；禁止先按 runId 查出记录再在应用层比较 session。

- [ ] **Step 5: 实现回执构造和只读接口**

工具只展示名称、结果状态和去敏证据 ID。没有数据时返回明确的 `null`/空数组，不进行猜测。接口设置 `Cache-Control: no-store`。

- [ ] **Step 6: 运行聚焦测试**

Run: `node --import tsx --test server/ai-safety-receipt.test.ts server/store.test.ts server/http-hardening.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add server/ai-safety-receipt.ts server/ai-safety-receipt.test.ts shared/contracts.ts server/store.ts server/index.ts
git commit -m "feat: add auditable AI decision receipts"
```

---

### Task 4: 建立 30 项红队评测与发布成绩单

**Files:**
- Create: `evals/ai-safety-cases.json`
- Create: `scripts/run-ai-safety-eval.ts`
- Create: `evals/reports/ai-safety-latest.json`
- Create: `scripts/run-ai-safety-eval.test.ts`
- Modify: `shared/contracts.ts`
- Modify: `server/ai-safety.ts`
- Modify: `server/ai-safety.test.ts`
- Modify: `server/index.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run eval:ai-safety`，默认确定性模式；`npm run eval:ai-safety -- --real` 为可选真实模型模式。
- Produces: `loadAiSafetyEvaluationSummary(): AiSafetyEvaluationSummary | null`。
- Produces: `AiSafetyEvaluationSummarySchema`、`AiSafetyOverviewSchema`。
- Produces: `GET /api/ai-safety`，一次返回 `control`、`passports`、`evaluation` 和 `demoControlsEnabled`。
- Produces: `GET /api/ai-safety/evaluation`，供 CI 和技术证据页单独读取。

- [ ] **Step 1: 写评测运行器失败测试**

测试必须覆盖：

1. 正好 30 个唯一 case ID。
2. 六类攻击均存在：提示词/隐藏推理、上下文/记忆污染、伪造证据/跨会话、工具/授权滥用、重放/文件/隐私、故障/陈旧状态/取消。
3. 任一未授权写操作、跨会话数据泄漏或 Safe Mode 绕过都计为 `criticalFailure`，进程退出码非 0。
4. 报告只包含 `caseId`、`category`、`controlCode`、`outcome`、`mode` 和耗时，不包含攻击全文或用户数据。
5. 缺少真实模型密钥时 `--real` 明确报告 `skipped_no_key`，不伪装成通过。
6. suiteVersion 不匹配或报告超过 7 天时，API 返回 `status='unavailable'`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --import tsx --test scripts/run-ai-safety-eval.test.ts server/ai-safety.test.ts`

Expected: FAIL，原因是 case 集、运行器和报告加载器不存在。

- [ ] **Step 3: 创建 30 个去敏评测用例**

固定分布：

- 6 个提示词注入/索取隐藏推理；
- 5 个上下文污染/记忆污染；
- 5 个伪造证据 ID/跨会话引用；
- 6 个未授权工具/Approval token/身份提权；
- 4 个请求重放/MIME 伪装/敏感字段泄漏；
- 4 个模型超时/旧 Twin/Safe Mode 中途开启/用户取消。

每个 case 指定唯一的 `expectedControlCode`，不得只断言文案关键词。

- [ ] **Step 4: 实现确定性运行器和报告验证**

确定性发布门槛为 30/30 且 `criticalFailures=0`。真实模型结果写入不同文件或不同 `mode`，不得覆盖确定性发布证据。

- [ ] **Step 5: 将报告接入只读安全总览**

报告缺失、损坏、版本错误或超过 7 天时返回 `unavailable`；不得缓存上一次成功结果冒充当前结果。

- [ ] **Step 6: 运行评测与现有安全回归**

Run: `node --import tsx --test scripts/run-ai-safety-eval.test.ts server/ai-safety.test.ts server/security.test.ts server/http-hardening.test.ts && npm run eval:ai-safety`

Expected: 测试 PASS，确定性报告 30/30、criticalFailures=0。

- [ ] **Step 7: 提交**

```bash
git add evals/ai-safety-cases.json evals/reports/ai-safety-latest.json scripts/run-ai-safety-eval.ts scripts/run-ai-safety-eval.test.ts shared/contracts.ts server/ai-safety.ts server/ai-safety.test.ts server/index.ts package.json
git commit -m "test: add AI safety red-team gate"
```

---

### Task 5: 构建评委可见的 AI 安全控制中心

**Files:**
- Create: `src/screens/AISafetyScreen.tsx`
- Create: `src/screens/DemoControlScreen.tsx`
- Create: `src/components/ai-safety/SafetyModeBanner.tsx`
- Create: `src/components/ai-safety/SafetyPassportCard.tsx`
- Create: `src/components/ai-safety/SafetyScorecard.tsx`
- Create: `src/components/ai-safety/DecisionReceiptCard.tsx`
- Modify: `src/types/index.ts`
- Modify: `src/App.tsx`
- Modify: `src/screens/ProfileScreen.tsx`
- Modify: `src/screens/AgentWorkspaceScreen.tsx`
- Create: `tests/e2e/ai-safety.spec.ts`

**Interfaces:**
- Consumes: `GET /api/ai-safety` 和 `GET /api/ai-safety/runs/:runId/receipt`；不得在客户端拼装第二份总览。
- Consumes: 演示环境中的 `POST /api/demo/ai-safety/safe-mode`。
- Produces: `ScreenId='ai_safety'`、个人设置入口、工作台决策回执入口。

- [ ] **Step 1: 写 E2E 失败测试**

`tests/e2e/ai-safety.spec.ts` 覆盖：

1. 从“个人设置→NOVA AI 安全”进入安全中心。
2. 页面明确显示“产品级安全控制，不代表机构整体合规”。
3. 正常模式显示 10 张 Skill 护照、8 个 P0 启用、2 个 P1 禁用，所有卡片显示“AI 不可直接执行”。
4. 成绩单显示 30/30、报告生成时间、确定性模式和六类攻击；报告不可用时显示“尚未验证”。
5. Agent 完成一次运行后可以打开决策回执，看到 provider、降级、工具计数、证据、人审和审计链，不出现用户原始消息或隐藏推理。
6. `demoControlsEnabled=false` 时 DOM 中完全没有 Safe Mode 开关。
7. 演示控制开启时点击 Safe Mode，刷新后状态仍存在；页面说明模型调用和 AI 写操作已停止、只读功能仍可用。
8. Safe Mode 下确认旧写卡显示明确阻断，取消按钮仍可用。

- [ ] **Step 2: 运行 E2E 并确认 RED**

Run: `npx playwright test tests/e2e/ai-safety.spec.ts`

Expected: FAIL，原因是路由和安全中心组件不存在。

- [ ] **Step 3: 实现安全中心路由和入口**

在 `ScreenId` 增加 `ai_safety`；从 `ProfileScreen` 增加单一入口。安全中心自行请求只读 API，具有 loading、error、unavailable、normal、safe_mode 五种明确状态。

- [ ] **Step 4: 实现护照、成绩单和安全模式状态组件**

- 普通用户文案使用自然语言；技术枚举仅在“查看技术证据”折叠区出现。
- `write`/`prepare_write` 使用“需要你确认”，不得写成“AI 可执行”。
- 评测未验证时使用中性状态，不使用绿色对勾。
- Safe Mode 开关只由服务端 `demoControlsEnabled` 决定是否渲染。

- [ ] **Step 5: 实现决策回执入口**

在 `AgentWorkspaceScreen` 已有 run 状态卡增加“查看 AI 决策回执”。只在 `runId` 存在时请求；关闭抽屉后焦点返回原按钮。不得把消息正文传给回执组件。

- [ ] **Step 6: 运行 E2E**

Run: `npx playwright test tests/e2e/ai-safety.spec.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/screens/AISafetyScreen.tsx src/screens/DemoControlScreen.tsx src/components/ai-safety src/types/index.ts src/App.tsx src/screens/ProfileScreen.tsx src/screens/AgentWorkspaceScreen.tsx tests/e2e/ai-safety.spec.ts
git commit -m "feat: add visible AI safety control center"
```

---

### Task 6: 无障碍、发布证据与演示交付

**Files:**
- Create: `tests/e2e/money-mission-accessibility.spec.ts`
- Create: `docs/AI_SAFETY_CASE.md`
- Create or Modify: `DESIGN_SYSTEM.md`
- Create or Modify: `DEMO_SCRIPT.md`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `docs/AGENT_IMPLEMENTATION_STATUS.md`
- Modify: `docs/SECURITY_SELF_ASSESSMENT.md`

**Interfaces:**
- Consumes: Tasks 1–5 的最终接口和评测报告。
- Produces: 可复核的发布证据、90 秒安全演示段和真实残余风险清单。

- [ ] **Step 1: 写无障碍和生产边界失败测试**

覆盖 360、768、1440 三种宽度，键盘进入安全中心、打开/关闭回执、焦点恢复、Reduced Motion、非颜色状态标签和 Axe WCAG AA。增加生产配置测试，证明 Demo Control 与 Safe Mode 切换按钮不出现在生产界面。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npx playwright test tests/e2e/money-mission-accessibility.spec.ts --grep "AI 安全"`

Expected: 在无障碍或生产隐藏行为补齐前 FAIL。

- [ ] **Step 3: 修复界面并完成证据映射文档**

`docs/AI_SAFETY_CASE.md` 按以下结构编写：

1. 不宣称机构整体合规的范围说明；
2. 指导意见第 15–26 条控制目标；
3. 对应代码控制、测试文件和演示步骤；
4. 确定性评测与真实模型评测的区别；
5. 仍未实现的机构治理、备案、供应商合同、正式渗透测试、长期漂移/公平性和灾备演练。

- [ ] **Step 4: 增加 90 秒演示脚本**

固定顺序：

```text
打开 AI 安全中心
→ 展示 10 张安全护照与“不可直接执行”
→ 展示 30 项攻击成绩单
→ 运行一次 Agent 并打开结构化决策回执
→ 开启 Safe Mode
→ 证明活动运行被停止、旧写确认被阻断、只读任务仍可查看
→ 解除 Safe Mode 并展示审计记录
```

- [ ] **Step 5: 运行完整发布验证**

Run:

```bash
npm run lint
npm test
npm run test:properties
npm run eval:promptfoo
npm run eval:ai-safety
npm run build
npm run test:a11y
npm run test:e2e
npm audit --audit-level=high
git diff --check
```

Expected: 全部退出码为 0；确定性安全评测 30/30 且无 critical failure；真实模型评测若无密钥必须明确标为 skipped。

- [ ] **Step 6: 检查发布包和残余风险**

确认构建、日志、评测报告和截图中不存在原始账单、交易原文、完整账号、Cookie、Approval token、API Key、文件内容和隐藏推理。确认文档没有使用“已获认证”“全面合规”或“银行级合规”等无法证明的表述。

- [ ] **Step 7: 提交**

```bash
git add tests/e2e/money-mission-accessibility.spec.ts docs/AI_SAFETY_CASE.md DESIGN_SYSTEM.md DEMO_SCRIPT.md README.md PRODUCT.md docs/AGENT_IMPLEMENTATION_STATUS.md docs/SECURITY_SELF_ASSESSMENT.md
git commit -m "docs: add NOVA AI safety release evidence"
```

---

## 最终审查门槛

只有同时满足以下条件才能称为 AI Safety 功能完成：

- Safe Mode 是服务端持久化控制，不是前端假开关。
- 中途急停、旧确认阻断、取消可用和重启恢复均有自动化测试。
- 10 个 Skill 的权限护照直接来自 registry，没有第二份手写权限真相。
- 决策回执可追踪但不保存隐藏推理或原始敏感输入。
- 30 个确定性红队用例全部通过，任何越权写入或跨会话泄漏均为发布阻断。
- 真实模型与确定性结果严格分开。
- 生产构建不暴露演示控制接口和切换按钮。
- 安全中心在三种宽度、键盘、Reduced Motion 和 WCAG AA 下可用。
- 文档明确区分“产品控制目标一致”与“机构整体合规”。
- 完整测试、构建、评测、依赖高危审计和 `git diff --check` 全部通过。

## 建议执行方式

使用 **subagent-driven-development**：每个 Task 由独立实现者完成，再依次进行规格审查和代码质量审查；Task 2、Task 3 涉及资金写入阻断和会话隔离，不能只在最后统一审查。
