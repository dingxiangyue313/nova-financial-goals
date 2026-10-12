# NOVA 本轮架构升级总结

## 1. 本轮升级的目标

本轮不是简单地把一个大模型替换成多个大模型，而是把旧的“综合 Agent 决定一切”改造成分层、可验证、可回滚的金融 Agent 架构：

```text
用户 / 新前台
  ↓
Agent API：身份、限流、Prompt Injection 检测、Rollout Gate
  ↓
Router
  ├─ Goal Agent：目标理解、可行性、创建/修改草案
  ├─ Coach Agent：只读财务解释
  └─ Safe Reject：非金融、低置信度、攻击输入
  ↓
确定性领域层
  ├─ Goal State Machine
  ├─ Feasibility Engine
  ├─ Financial Twin
  └─ Permission / Risk / Approval / Idempotency / Audit
  ↓
Banking Sandbox / MCP Tools
```

核心原则是：**LLM 负责理解与建议，确定性服务负责规则、授权和执行。**

## 2. 升级前是什么状态

升级前主要是 Baseline 0 综合 Agent：

- 一个 Agent 同时处理意图、实体、计划和工具选择；
- 前端曾保留旧 Demo Orchestrator 和 Mock Tool 链路；
- 缺少可比较的架构基线；
- token、Evidence ID、Feasibility 没有形成统一遥测；
- Agent 与确定性 Workflow 的职责边界不够清晰；
- 目标激活主要依靠前端确认标记，还不是完整的 Approval Snapshot 闭环。

## 3. 本轮具体做了什么

### 3.1 退出旧 Demo Orchestrator

删除旧的 Demo 编排文件：

- `agent-orchestrator.ts`
- `mock-banking-tools.ts`
- `governance.ts`
- `external-agent-runtime.ts`

前端入口只保留 `NovaFusionApp`，Agent、Twin 和 Banking Tools 统一走服务端接口。

### 3.2 建立 Baseline 与统一评测

补齐统一遥测：

- Provider token usage；
- Evidence IDs；
- Feasibility Engine 复核结果；
- Intent、Entity、Tool Selection；
- Prompt Injection；
- Unsafe Tool Attempt；
- P95 latency；
- fallback 安全性。

Baseline 0 与 Candidate 1 使用同一套 Fixture、Policy、Financial Twin 和测试用例，避免比较时改变底层条件。

### 3.3 阶段一：Shadow Mode

- 用户响应仍来自 Baseline；
- Candidate 并行只读运行；
- 对比 Intent、Entity、Tool Plan、Security、Evidence、Feasibility、Token 和 latency；
- 对比记录写入用户隔离数据库和 Audit；
- Candidate 失败不影响用户响应。

### 3.4 阶段二：低风险只读接管

- 财务解释交给 Coach Agent；
- 纯目标可行性分析交给 Goal Agent；
- 创建、修改、激活和资金操作仍留在 Baseline；
- 客户端不能自行指定生产架构；
- 增加 `phase2 → shadow` 回滚。

### 3.5 阶段三：真实 DeepSeek Router 与创建草案

- Candidate Router 接入真实 DeepSeek；
- 模型输出必须通过 Zod Contract；
- 工具计划仍由确定性代码生成；
- 创建目标只生成 `requiresApproval=true` 的草案；
- 引入三层回退：DeepSeek → 受限 deterministic → Safe Reject；
- 修复 Prompt Injection 后恢复成 `create_goal` 的安全 fallback 问题；
- 增加100条未见表达和对抗测试。

真实 Provider 三轮扩展测试：Candidate 360个样本，Intent、Entity、Tool Selection、Injection、Evidence、Feasibility 均为100%，Unsafe Tool Attempt 为0%，P95 为1,031ms。

### 3.6 阶段四：修改目标草案

- Goal Agent 可以理解普通目标修改请求；
- 重新读取 Financial Twin；
- 调用 Feasibility Engine 复核；
- 调用 `prepare_goal_adjustment` 生成变更方案；
- 生成 `update_goal` 待审批草案；
- “确认修改、立即激活、转账、支付、授权”等请求不会进入 Candidate Gate。

服务端增加修改目标安全验证：

- `goalId + changes` 与 Approval Snapshot 绑定；
- 参数篡改使授权失效；
- Token 单次消费；
- Idempotency Key 与输入哈希绑定；
- 成功写入 `goal_updated` Audit。

### 3.7 阶段五：目标激活审批闭环

前台“确认并激活”不再直接修改 Twin，而是：

```text
create_approval_snapshot
  → confirm_approval（用户明确确认）
  → activate_goal
  → Financial Twin 更新
  → goal_activated Audit + Receipt
```

Snapshot 绑定 `goalId + selectedPlan + twinVersion`。方案或 Twin 版本变化会使旧授权失效；执行支持幂等重试。激活结果明确返回 `autoTransferAuthorized=false`，因此激活目标不等于授权自动转账。

## 4. 当前架构如何决定请求去哪里

| 用户请求 | 当前处理组件 | LLM 能否直接执行 |
| --- | --- | --- |
| 财务解释 | Candidate Coach Agent | 否，只读证据 |
| 目标可行性 | Candidate Goal Agent + Feasibility Engine | 否 |
| 创建目标 | Candidate Goal Agent 生成草案 | 否，等待确认 |
| 修改目标 | Candidate Goal Agent 生成修改草案 | 否，等待确认 |
| 确认与激活 | Approval Workflow + `activate_goal` | 否，由确定性服务执行 |
| 转账、支付、扣款 | Banking Sandbox | 否，由 Permission/Risk/Approval 控制 |
| 外部 Agent 请求 | MCP + 签名 + Mandate | 否，受服务端边界约束 |
| Prompt Injection | Safe Reject / Baseline | 不调用金融工具 |
| Provider 失败 | deterministic fallback / Safe Reject | 不扩大权限 |

## 5. 现在已经完成什么

### 已完成并有自动化验证

- Goal-first 主链路 Contracts、Fixtures、State Matrix；
- Goal Readiness → Feasibility → Draft → Approval → Activation → Impact 的核心链路；
- 真实 DeepSeek Router；
- Goal Agent、Coach Agent 与 Safe Reject 分工；
- Shadow 对照与分阶段 Rollout Gate；
- `phase4 → phase3 → phase2 → shadow` 回滚；
- token、Evidence ID、Feasibility、latency 遥测；
- Prompt Injection 前置检测；
- Zod 结构化输出校验；
- deterministic fallback；
- Financial Twin 统一服务端状态；
- 现金流预测、目标竞争、目标影响模拟；
- Banking Sandbox 与 MCP 工具协议；
- 用户/沙箱数据隔离；
- Approval Snapshot 哈希绑定；
- 一次性 Approval Token；
- 参数变化后授权失效；
- 幂等执行、冲突检测和重放防护；
- Mandate 版本、暂停、撤销和过期边界；
- 外部 Agent 签名和身份校验；
- Tool Timeout 的状态未知语义与 Operation ID；
- Audit 和可验证导出；
- 创建、修改、激活目标的受控服务端链路；
- 前端目标激活按钮接入真实 Approval Workflow；
- TypeScript / Vinext 生产构建；
- Goal Flow、Banking Security、Financial Twin 和 Agent 自动化回归。

### 当前产品完成度判断

目前已经达到**比赛级可交互 MVP / Banking Sandbox**：

- 可以演示完整 Goal-first 用户路径；
- 可以证明 Agent 与银行执行层的权限隔离；
- 可以演示篡改、重放、越权和 Prompt Injection 被拒绝；
- 可以提供遥测、Receipt 和 Audit 作为比赛证据；
- 不再只是静态页面 Demo。

但它还不是可真实服务银行客户的生产系统。

## 6. 还有什么没有完成

### P0：生产前必须完成

1. **真实身份认证与账户体系**
   - 当前主要使用比赛 Sandbox Session；
   - 需要接入真实登录、Session、设备绑定、权限与账户恢复。

2. **真实银行核心系统集成**
   - 当前账户、交易、支付和余额仍是模拟数据；
   - 尚未连接微众银行真实账户、支付清算、理财、信贷或保险系统。

3. **密钥和部署配置正式化**
   - DeepSeek 密钥测试时为临时进程注入；
   - 需要部署平台 Secret、轮换、调用配额、告警和泄漏响应。

4. **生产数据存储和迁移**
   - 当前使用比赛用 D1/Sandbox 数据模型；
   - 需要生产数据库、加密、备份、恢复、数据保留和迁移策略。

5. **合规与隐私评审**
   - 需要数据最小化、用户授权、隐私政策、模型数据边界、日志脱敏、监管留痕和删除机制。

### P1：比赛展示仍应补强

1. **创建与修改草案的前端审批面板**
   - 后端安全链路已存在；
   - 前端目前对目标激活接线最完整，创建/修改目标还需要展示参数差异、Snapshot Hash、有效期和明确确认按钮。

2. **Activity 使用真实 Audit 查询**
   - 后端已有 `get_activity` 与 Audit；
   - 前台 Activity 仍主要展示 Twin activity，应合并真实工具 Audit、Operation ID、Permission、Risk 和 Receipt。

3. **Today / Life / Twin / Activity 全页面统一接线复核**
   - Financial Twin 核心状态已统一；
   - 仍需逐页确认不存在遗留 simulator 或只改本地 UI 的路径。

4. **真实失败恢复 UI**
   - 需要明确展示 Provider timeout、Tool unknown、Snapshot expired、Twin version changed、manual review 和 safe retry。

5. **攻击演示产品化**
   - 后端测试已覆盖篡改与重放；
   - 可增加评委可操作的“修改金额后执行”演示，并显示服务器拒绝证据。

### P2：架构质量继续提升

1. 扩展未见测试到更多多轮对话、方言、口语、省略和混合意图；
2. 加入真实线上匿名评测、漂移监控和 Canary 指标；
3. 将 Prompt、Policy、Tool Contract 和 Fixture 全部版本化；
4. 增加 Provider 熔断、预算控制和多 Provider 灾备；
5. 增加 OpenTelemetry、错误率、P95/P99、token 成本和告警面板；
6. 为 Approval、Mandate、Operation 和 Audit 增加管理后台；
7. 完成渗透测试、依赖安全扫描和供应链检查；
8. 做并发、故障注入、数据库恢复和灾备演练。

## 7. 当前明确不应该做的事

- 不应让 LLM 直接转账或支付；
- 不应让 Agent 自行确认 Approval；
- 不应把目标激活等同于自动扣款授权；
- 不应让客户端决定使用哪个 Agent；
- 不应因为固定测试集100%就宣称达到生产安全；
- 不应在尚未真实接入的情况下声称已接入微粒贷、理财或保险。

## 8. 建议的下一轮顺序

1. 完成创建/修改目标的真实审批 UI；
2. 把 Activity 接到真实 Audit、Operation 和 Receipt；
3. 做一次四页面状态一致性端到端测试；
4. 增加评委可操作的篡改攻击演示；
5. 配置部署 Secret、限额、日志脱敏和监控；
6. 最后再考虑自动储蓄 Mandate，且必须独立授权、可撤销、可过期。

## 9. 一句话总结

本轮把 NOVA 从“一个综合 Agent 驱动的比赛 Demo”升级为“LLM 负责理解、确定性 Workflow 负责决策、Banking Sandbox 负责受控执行，并且可评测、可审计、可回滚的 Goal-first 金融 Agent MVP”。
