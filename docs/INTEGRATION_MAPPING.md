# NOVA 四页集成对照

本文件固定本次整合的来源：界面取自 `dingxiangyue313/nova-financial-goals@805a0f6`，业务与安全基线取自 `Amy-Lin365/NOVA-AI-Banking-Agent@ca1124c`。目标仓库是 `dingxiangyue313/nova-financial-goals`。`PRODUCT.md` 决定用户可见行为；模拟 Financial Twin 是金额与目标状态的唯一数据源。

| 页面与用户任务 | 用户界面保留项 | 服务端数据与接口 | 用户动作与状态变更 | 动态组件 |
| --- | --- | --- | --- | --- |
| 首页：看目标能否按时完成 | 问候、我的目标、日本旅行卡、进度、下一步和轻量提醒 | `GET /api/financial-twin` 的 `state.goals`、`derived.goalProgress`、`forecast`；`GET /api/goal-flow?context=home` 的目标可行性 | 查看目标、创建目标；只有合格的目标影响事件显示提醒 | 原目标卡保留视觉，`goal_feasibility_card` 展示可行性 |
| 创建目标：用原话提出约束 | 原话卡、NOVA 理解节点、修正入口 | `POST /api/agent` 返回意图草案；`POST /api/banking-tools` 创建和确认审批快照，随后执行 `create_goal` | 用户修正金额、日期、受保护资金；明确确认后才写入目标 | 原型输入卡；`goal_input_card`、`assumption_editor` 留待后续迁移 |
| 可行性：比较并选择方案 | 三阶段、最多三种节奏、推荐标记、确认按钮 | `GET /api/goal-flow?context=feasibility` 从 Financial Twin 生成可行性与方案；激活由受控 Banking Tool 完成 | 每个 Goal 的 `selectedPlan` 初始为 `null`；选择方案后允许确认，激活不授权自动转账 | `goal_feasibility_card`、`scenario_compare` |
| 目标影响：理解变化并调整 | 原因链、应急金保护提示、两种调整方案 | `POST /api/goal-flow` 的 `preview` 从 Financial Twin 生成只读支出情景；实际调整走审批和受控工具 | 小额变化保持安静；显著变化显示影响；用户选择调整或返回方案 | `goal_impact_signal`；情景选择保留原型控件 |

## 共享约定

- 服务端金额单位是**分**，UI 只在显示和输入边界转换为元；不在组件内部重算财务结果。
- 日期在接口中采用 ISO `YYYY-MM-DD`，界面显示为简体中文日期。
- “NOVA 推荐”仅是标签；未选择方案时禁用确认按钮，任何 fallback 都不得默认选择平衡方案。
- DeepSeek 优先解析意图并生成用户可读解释；当前目标组件由服务端从白名单确定性组装。可行性、延期、权限和资金操作由确定性逻辑决定。无 Key 时使用确定性演示模式。
- 生成组件必须通过 Zod 校验。未知类型或无效数据展示安全降级卡；组件动作只提交受限 intent，不能直接调用 Banking Tool。
- 用户界面不展示 Financial Twin、Agent Runtime、Schema 等内部术语。所有金融数据与操作标明为模拟。

## 实施判断

队友项目原有 `goal-engine.ts` 与静态 `buildGoalCanvas()` 保留为历史演示契约，仍含固定 Fixture 值；真实四页使用 `getGoalReadiness()` 和 `buildLiveGoalCanvas()`，只读取 Financial Twin。每个 Goal 的方案可为空，服务端阻止未选择方案的激活。后续可以把历史演示契约移出生产路由。
