# NOVA 四页集成对照

本文件固定本次整合的来源：界面取自 `dingxiangyue313/nova-financial-goals@805a0f6`，业务与安全基线取自 `Amy-Lin365/NOVA-AI-Banking-Agent@ca1124c`。目标仓库是 `dingxiangyue313/nova-financial-goals`。`PRODUCT.md` 决定用户可见行为；模拟 Financial Twin 是金额与目标状态的唯一数据源。

| 页面与用户任务 | 用户界面保留项 | 服务端数据与接口 | 用户动作与状态变更 | 动态组件 |
| --- | --- | --- | --- | --- |
| 首页：看目标能否按时完成 | 问候、我的目标、日本旅行卡、进度、下一步和轻量提醒 | `GET /api/financial-twin` 的 `state.goals`、`forecast`；GoalFeasibility 的 `on_track / at_risk / insufficient_data / infeasible` | 查看目标、创建目标；只有合格的目标影响事件显示提醒 | `goal_progress_card`、必要时 `goal_impact_signal` |
| 创建目标：用原话提出约束 | 原话卡、NOVA 理解节点、修正入口 | `POST /api/agent` 返回意图草案；`POST /api/banking-tools` 创建和确认审批快照，随后执行 `create_goal` | 用户修正金额、日期、受保护资金；明确确认后才写入目标 | `goal_input_card`、`assumption_editor` |
| 可行性：比较并选择方案 | 三阶段、最多三种节奏、推荐标记、确认按钮 | `POST /api/goal-flow` 的 GoalFeasibility/GoalFlowState；Financial Twin 目标与现金流数据；激活由受控 Banking Tool 完成 | 初始 `selectedScenario=null`；选择方案后允许确认，激活不授权自动转账 | `goal_feasibility_card`、`scenario_compare`、`plan_steps` |
| 目标影响：理解变化并调整 | 原因链、应急金保护提示、两种调整方案和稍后处理 | `POST /api/financial-twin` 的 `simulate_expense` 只读预览；GoalImpactSignal 判断是否达到提醒条件；实际调整走审批和受控工具 | 小额变化保持安静；显著变化显示影响；用户选择调整、稍后或忽略 | `goal_impact_signal`、`impact_summary`、`scenario_compare` |

## 共享约定

- 服务端金额单位是**分**，UI 只在显示和输入边界转换为元；不在组件内部重算财务结果。
- 日期在接口中采用 ISO `YYYY-MM-DD`，界面显示为简体中文日期。
- “NOVA 推荐”仅是标签；未选择方案时禁用确认按钮，任何 fallback 都不得默认选择平衡方案。
- DeepSeek 仅解析意图、生成用户可读解释与白名单组件选择；可行性、延期、权限和资金操作由服务端确定性逻辑决定。无 Key 时使用确定性演示模式。
- 生成组件必须通过 Zod 校验。未知类型或无效数据展示安全降级卡；组件动作只提交受限 intent，不能直接调用 Banking Tool。
- 用户界面不展示 Financial Twin、Agent Runtime、Schema 等内部术语。所有金融数据与操作标明为模拟。

## 实施判断

队友项目现有 `goal-engine.ts` 与 `generative-ui.ts` 含固定演示金额，`financial-twin-contracts.ts` 的 `selectedPlan` 也强制非空。整合时要消除这些来源冲突：Financial Twin 提供事实，GoalFeasibility 从当前事实计算，方案选择改为可空，生成卡片只消费同一结果。
