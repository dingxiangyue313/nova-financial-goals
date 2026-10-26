# NOVA v0.6 双轨并行开发计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the referenced detailed plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **用途：** 给两位开发者共同执行。本文负责工作边界、并行顺序、接口交接与合并规则；每项功能的具体 TDD 步骤，以同目录的 `NOVA_v0.6_DETAILED_IMPLEMENTATION_PLAN.md` 为准。

**Goal:** 在不接入真实银行、微信支付和支付宝的前提下，把 NOVA 做成一条完整、可恢复、可验证的高保真 Money Mission：账单导入与分析 → 订阅取消 → 现金流预测 → 目标方案 → 工资到账触发储蓄 → 监控与修复。

**Architecture:** 以冻结的 Zod Schema、API 响应和样例 JSON 为边界，拆成服务端 Financial Core/Agent 与客户端 Product Experience/Quality 两条并行开发线。两条线拥有互斥文件路径，只在三个 Gate 上按“核心先、产品后”的顺序集成。

**Tech Stack:** TypeScript 7、Node.js 22、React 19、Express 4、SQLite、Zod 4、Tailwind CSS 4、Node test runner、Playwright、Promptfoo。

**Spec:** `NOVA_v0.6_DEEPENING_PRD.md`；详细实现任务见 `NOVA_v0.6_DETAILED_IMPLEMENTATION_PLAN.md`。

**拆分原则：**

- 第一部分只修改服务端、共享契约、数据与 Agent/Skill 代码。
- 第二部分只修改客户端、端到端测试与产品交付文档。
- 两部分通过冻结的 API/Schema 和样例 JSON 协作，不直接修改对方负责的文件。
- 集成时固定先合并第一部分，再合并第二部分。
- 所有金额使用整数分，日期使用 `YYYY-MM-DD`，用户时区统一为 `Asia/Shanghai`。

## Global Constraints

- 保留当前导航、青绿色视觉、手机框架和目标优先首页。
- 账单历史不能覆盖权威当前余额或目标已存金额。
- 比赛构建默认关闭任意文件上传，但合成样例必须完整可用。
- 原始文件不得进入模型上下文、模型日志或产品分析。
- 财务写操作必须经过 Permission → Risk → Execute → Verify → Audit，且保持幂等。
- P0 只支持一次性和月度转账；同一目标最多一个有效月度计划。
- 工资最迟在 27 日 23:59 前匹配；缺失则跳过当期且不自动补扣。
- 只有商户验证 `nextChargeSuppressed=true` 后，订阅节省才进入预测。
- Skills 1–5、8–10 为 P0；Skills 6–7 保持禁用的 P1 Stretch。
- 核心流程必须通过 360、768、1440 三种宽度、键盘、Reduced Motion 和 WCAG AA。

## Review Focus

- 伪造余额的账单不得改变权威余额或目标存款；第一部分 A1 负责回归测试。
- 订阅取消超时/失败不得移除 CloudBox 费用；第一部分 A2 和第二部分 B3 共同验收。
- 延迟或缺失工资不得触发固定日扣款或追补；第一部分 A3 和第二部分 B3 共同验收。
- 预览后 Twin 变化或幂等键换参数必须无部分写入地失败；第一部分负责测试，第二部分负责恢复界面。
- Prompt injection、跨会话 ID 和原始文件泄漏必须被拒绝或隔离；第一部分负责安全测试，第二部分负责安全展示。

## 0. 开发前共同确认

两人先共同阅读：

1. `NOVA_v0.6_DEEPENING_PRD.md`：产品边界和验收标准。
2. `NOVA_v0.6_DETAILED_IMPLEMENTATION_PLAN.md`：15 个详细 TDD 任务。
3. `IMPLEMENTATION_PLAN.md`：计划入口和执行顺序。

当前基础状态（2026-10-27）：

- Task 1：核心契约与 Japan Money Mission 权威样例已完成。
- Task 2：会话隔离的持久化层已完成。
- Task 3：账单解析、校对、提交与余额快照正在实现。
- 两条开发线正式并行前，以 Task 3 合并后的提交作为共同基线。

建议分支：

```text
integration/nova-v06
├── feature/nova-v06-core
└── feature/nova-v06-product
```

两条 feature 分支必须从同一个已通过 Task 1–3 测试的提交创建。

---

# 第一部分：Financial Core、Agent 与服务端

## 负责人边界

第一部分独占修改以下路径：

```text
shared/**
server/**
evals/**
scripts/run-money-mission-eval.ts
package.json
package-lock.json
.env.example
promptfooconfig.yaml
```

第一部分不得修改：

```text
src/**
tests/e2e/**
DESIGN_SYSTEM.md
DEMO_SCRIPT.md
README.md
PRODUCT.md
docs/AGENT_IMPLEMENTATION_STATUS.md
```

## A1. 数据基础与权威来源

对应详细计划：Task 1–3。

交付内容：

- Money Mission Zod 契约、十个 Skill ID、权威 Japan Trip 样例。
- SQLite 持久化与跨会话隔离。
- CSV、XLSX、PDF、图片四类账单解析。
- 导入预览、问题校对、提交、撤销与幂等控制。
- 独立余额快照确认；账单历史不得覆盖当前余额和目标存款。
- 上传默认关闭，合成样例始终可用。

完成标准：

- 四种格式得到相同的标准化交易结果。
- 导入、撤销、重复提交、跨会话访问和过期 Twin 均有测试。
- `Account.balanceCents`、`Finance.checkingCents` 和 `Goal.savedCents` 不受账单中的“余额”字段影响。
- Task 1–3 的聚焦测试、全量单元测试、类型检查和构建全部通过。

对第二部分的交付：

- 冻结 `MoneyMissionReadModel` 及相关 API 响应类型。
- 提供合成样例导入、导入问题、余额快照三个成功响应样例。
- 提供上传关闭、阻塞问题、Twin 过期三个错误响应样例。

## A2. 账单洞察与订阅取消

对应详细计划：Task 4–5。

交付内容：

- 月度/年度账单摘要、分类变化、订阅候选和证据引用。
- 事实、假设、预测、限制四类来源标签。
- CloudBox 保留、提醒、取消、非订阅四类选择。
- 准备 → 精确确认 → 商户模拟执行 → 验证 → 对账完整生命周期。
- 只有 `nextChargeSuppressed=true` 才允许把订阅节省计入后续预测。

完成标准：

- 退款、内部转账、同金额无关消费、低置信度与缺失月份有覆盖。
- `unknown`、`failed` 和超时不显示为成功，不移除未来费用。
- 取消操作具有独立操作 ID、验证结果、审计记录和幂等结果。

对第二部分的交付：

- Bill Brief、Evidence、Subscription Action 和 Receipt 的样例 JSON。
- 明确所有状态枚举及每个状态允许显示的 CTA。

## A3. 现金流、目标方案与转账计划

对应详细计划：Task 6–9。

交付内容：

- 按日期排序的现金流事件账本。
- baseline、stress、edited 三种情景。
- 稳健、平衡、加速三种目标计划。
- 一次性/月度转账计划预览、激活、暂停、恢复和取消。
- 工资事件识别、次日执行、每周期幂等与失败对账。
- 27 日结束仍未识别工资时跳过当月，不按固定日期扣款，不补扣。

冻结验收值：

| 项目 | 结果 |
|---|---:|
| 取消 CloudBox 后最低余额 | ¥3,240 |
| CloudBox 仍有效时最低余额 | ¥3,172 |
| 稳健方案 | ¥750 × 8，2027-06-26 完成 |
| 平衡方案 | ¥1,000 × 6，2027-04-26 完成 |
| 加速方案 | 首笔 ¥1,200 + ¥1,200 × 4，2027-02-26 完成 |

完成标准：

- 缺少权威余额时可以解释范围，但不得生成可执行计划。
- 同一目标最多一个有效月度计划。
- 计划激活不立即转账；每次真实计划执行都重新经过 Risk、幂等、Verify 和 Receipt。
- 工资相似交易、金额边界、日期边界、余额不足、重启回放均有测试。

对第二部分的交付：

- Forecast、GoalPlanOption、TransferSchedule 和 TransferExecution 样例 JSON。
- 每个操作所需的精确确认文案参数。

## A4. Skills、服务端读模型、监控与评估

对应详细计划：Task 10、Task 11 的服务端部分、Task 14 的服务端部分、Task 15 的服务端与评估部分。

交付内容：

- 注册十个 Skill，其中八个 P0 开启，Skills 6–7 保持禁用。
- 每个 Skill 的输入输出 Schema、工具白名单和预算。
- `GET /api/money-mission` 聚合读模型。
- 订阅变化、工资缺失、转账失败/未知、目标参数变化监控。
- 隐私最小化 Handoff Case Pack。
- 产品事件白名单和 Money Mission 确定性评估。

完成标准：

- 模型只能路由、询问和解释，不产生未经服务端验证的金额、日期、状态或执行参数。
- Prompt injection、模型故障和越权工具调用安全降级。
- 原始文件、交易描述、完整账号、Approval token 和 API key 不进入模型、日志或分析事件。
- 服务端完整测试、属性测试和确定性评估通过。

---

# 第二部分：产品界面、交互、E2E 与交付

## 负责人边界

第二部分独占修改以下路径：

```text
src/**
tests/e2e/**
DESIGN_SYSTEM.md
DEMO_SCRIPT.md
README.md
PRODUCT.md
docs/AGENT_IMPLEMENTATION_STATUS.md
```

第二部分不得修改：

```text
shared/**
server/**
package.json
package-lock.json
.env.example
promptfooconfig.yaml
evals/**
scripts/**
```

如果界面需要新的字段、端点或依赖，只提交“接口变更请求”，由第一部分负责人修改；第二部分不得直接进入服务端或 lockfile 修补。

## B1. Money Mission 产品壳与状态系统

对应详细计划：Task 11 的客户端部分。

交付内容：

- 从首页进入“日本旅行 Money Mission”。
- 七阶段进度：目标、数据、账单、订阅、计划、转账、监控。
- 已完成阶段可以回看，当前阶段和下一步 CTA 唯一确定。
- 保留现有顶栏、底部导航、青绿色视觉体系和桌面 Governed Canvas。
- 手机/平板单列，桌面可显示进度与上下文侧栏。

并行开发方式：

- 使用第一部分提供的冻结类型和样例 JSON 开发。
- 所有金额、日期和阶段判断直接消费读模型，不在 React 中重新计算。
- API 尚未就绪时，只使用客户端 fixture adapter；正式集成时替换 adapter，不修改组件逻辑。

完成标准：

- 360、768、1440 三种宽度不破版。
- 加载、空、部分、过期、失败、离线只读状态都有明确界面。

## B2. 数据导入与账单洞察界面

对应详细计划：Task 12。

交付内容：

- 合成样例/上传能力选择。
- 独立余额快照输入与确认。
- 解析进度、问题列表、字段纠正、提交和撤销。
- 数据覆盖范围、质量和时效提示。
- 月度/年度账单摘要、变化说明、订阅候选与证据抽屉。

完成标准：

- 上传关闭时不渲染系统文件选择器。
- 事实、假设、预测、限制使用文字标签，不能只靠颜色。
- 重要结论都能查看来源、日期和交易证据。
- 刷新后仍能恢复服务端保存的结果。

## B3. 订阅、现金流、目标方案与转账界面

对应详细计划：Task 13。

交付内容：

- CloudBox 详情与证据。
- 保留、提醒、取消、非订阅四种选择。
- 精确操作确认和独立回执。
- 现金流时间线与三方案对比。
- What-if 编辑形成新的 Preview。
- 工资到账触发型计划的配置、激活、暂停、恢复和取消。

完成标准：

- 按钮明确写出动作、金额或商户，不使用含糊的“确认”。
- “26 日”只显示为预计执行日；确认页明确实际由工资识别触发，缺失则跳过。
- 订阅取消、计划激活和每次转账有不同的操作 ID 与回执。
- unknown、failed、merchant-only、stale approval、余额不足和计划冲突都有恢复入口。

## B4. 监控、解释与人工交接界面

对应详细计划：Task 14 的客户端部分。

交付内容：

- 订阅涨价、工资缺失、转账失败/未知和目标变化通知。
- 去重后的重要变化提示。
- 修复候选预览：跳过、调整日期、暂停等。
- 证据来源解释与人工交接 Case Pack 展示。

完成标准：

- 修复建议在用户确认前不会改写计划。
- 普通界面使用自然语言；工具名、枚举和技术字段只出现在审计/导出中。
- Case Pack 不显示原始文件和完整账号。

## B5. 响应式、无障碍、演示与文档

对应详细计划：Task 15 的客户端、E2E 和文档部分。

交付内容：

- 独立 Demo Control 页面；生产用户界面不显示演示控制。
- 完整主路径和恢复路径 E2E。
- 键盘、焦点恢复、Reduced Motion、非颜色状态与 WCAG AA 验收。
- 九分钟核心演示脚本。
- 设计系统、README、PRODUCT 和实现状态文档更新。

完成标准：

- 完整空会话流程连续跑五次。
- Playwright 在 360、768、1440 三个项目通过。
- 核心演示不依赖 P1 外部旅行 Agent。

---

# 两部分之间的接口冻结

## 第一部分必须提供的契约

第二部分只依赖以下稳定入口：

| 类别 | 稳定入口 |
|---|---|
| 总读模型 | `GET /api/money-mission` |
| 数据导入 | templates、sample、upload、issue resolution、commit、revoke |
| 余额快照 | prepare + `/api/agent/action` 确认 |
| 账单与证据 | bill brief、evidence detail |
| 订阅 | prepare/status + `/api/agent/action` 确认 |
| 现金流与计划 | forecast、three plan options、What-if preview |
| 转账计划 | preview/status/lifecycle + `/api/agent/action` 确认 |
| 监控与交接 | notifications、repair preview、handoff case pack |

接口规则：

- 已冻结字段只允许增加可选字段，不允许改名、改类型或改变语义。
- 错误统一返回稳定 `error.code`，界面不得解析错误字符串。
- 所有写操作返回新的 Twin Version 和可查询的操作/回执 ID。
- 所有样例响应必须通过与服务端相同的 Zod Schema。

## 接口变更流程

1. 第二部分发现缺字段时，只写一条接口变更请求：使用场景、所需字段、空值行为、对应界面状态。
2. 第一部分在共享契约中添加字段和服务端测试，并提供更新后的样例 JSON。
3. 第一部分提交并通过测试后，第二部分再更新消费代码。
4. 不允许两人在各自分支分别修改同一契约文件。

---

# 并行里程碑与合并顺序

## Gate 0：共同基线

必须满足：

- Task 1–3 完成并审查通过。
- `npm test`、`npm run lint`、`npm run build` 通过。
- API 类型和成功/失败样例冻结。

完成后从同一提交创建两条 feature 分支。

## Gate 1：第一段可联调产品

第一部分完成 A2；第二部分完成 B1–B2。

验收故事：

```text
进入 Money Mission
→ 导入合成账单
→ 修正问题并提交
→ 查看账单摘要和 CloudBox 证据
```

合并顺序：

1. `feature/nova-v06-core` 合入 `integration/nova-v06`。
2. 第一部分跑服务端与完整单元测试。
3. `feature/nova-v06-product` 更新到 integration 最新提交。
4. 第二部分解决纯消费端适配后合入。
5. 跑该段 E2E。

## Gate 2：核心 Money Mission 闭环

第一部分完成 A3；第二部分完成 B3。

验收故事：

```text
确认取消 CloudBox
→ 获得验证回执
→ 查看最低余额和三种计划
→ 选择平衡方案
→ 激活工资到账触发的月度储蓄
```

使用与 Gate 1 相同的“核心先、产品后”合并顺序。

## Gate 3：监控与发布候选

第一部分完成 A4；第二部分完成 B4–B5。

验收故事：

```text
工资缺失或转账异常
→ 收到一次重要通知
→ 查看原因和修复预览
→ 用户确认后执行修复或生成 Case Pack
```

最终验证：

```bash
npm run lint
npm test
npm run test:properties
npm run eval:promptfoo
npm run eval:money-mission
npm run build
npm run test:a11y
npm run test:e2e
git diff --check
```

---

# 防冲突规则

1. **路径独占：** 不修改另一部分拥有的路径，即使改动看起来很小。
2. **禁止全仓格式化：** 只格式化自己实际修改的文件。
3. **Lockfile 单一负责人：** 只有第一部分修改 `package.json` 和 `package-lock.json`。
4. **契约单一负责人：** 只有第一部分修改 `shared/contracts.ts` 和 API 响应结构。
5. **E2E 单一负责人：** 只有第二部分修改 `tests/e2e/**`。
6. **小批量提交：** 每个任务完成 RED→GREEN→全量回归后提交，不把多个里程碑混在一个提交中。
7. **固定合并顺序：** 每个 Gate 都是核心分支先合并，产品分支后更新、适配、合并。
8. **不在两条 feature 分支互相 merge：** 只通过 `integration/nova-v06` 交换已通过 Gate 的工作。
9. **共享缺陷归属：** 服务端响应/业务计算问题归第一部分；展示/交互/E2E 问题归第二部分；契约理解冲突以 PRD 为准。
10. **主分支保护：** 两条线都不能直接合入 `main`；完整发布验证和双人审查通过后再合并。

---

# 每日协作格式

每天只同步四项：

```text
已完成：任务/提交
正在做：当前最小任务
接口变化：无 / 请求编号及原因
阻塞：无 / 需要对方提供什么
```

每个 Gate 结束时共同检查：

- 接口样例是否与真实响应一致。
- UI 是否只展示服务端已验证的数据。
- 写操作是否经过 Permission → Risk → Execute → Verify → Audit。
- `unknown` 和 `failed` 是否始终显示为未成功。
- 刷新、重复点击、跨会话和过期 Twin 是否安全。
- 三种屏幕宽度、键盘和 reduced motion 是否通过。

## 完成定义

只有同时满足以下条件，NOVA v0.6 才算完成：

- 主路径和恢复路径均能从空会话完成。
- 权威余额、目标存款和现金流计算来源清晰且可追溯。
- 取消订阅和每次转账都有独立、可验证的回执。
- 工资缺失不会触发固定日扣款或自动补扣。
- 八个 P0 Skill 可用；两个 P1 Skill 保持注册但禁用。
- 服务端测试、属性测试、评估、构建、无障碍和三宽度 E2E 全部通过。
- 两位开发者分别审查对方在最后一个 Gate 中的改动。
