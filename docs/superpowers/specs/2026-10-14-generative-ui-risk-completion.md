# NOVA Generative UI 与风险闭环补全

## 产品目标

在现有 Generative UI、Financial Twin 和目标感知风险引擎上补齐可编辑目标假设、What-if 试算、计划步骤、完整风险偏好，以及安静的每周摘要会话。继续坚持“不用记账，也知道目标能不能按时实现”。

## 体验要求

- 桌面端采用画布主导布局：左侧约 32% 为对话，右侧约 68% 为 Governed Canvas；会话历史通过可展开入口访问。
- 手机端保持单列消息流，受治理组件随消息内联显示。
- 用户可编辑目标金额、日期、每月投入、受保护资金和可浮动周数；试算不写入状态，确认后才更新 Financial Twin。
- 普通趋势按周生成安静的应用内摘要会话，不显示紧急红点、不抢占首页；显著目标恶化继续创建未读风险会话。
- 风险偏好支持每周摘要、金额阈值、目标占比阈值、暂停日期、静默时间和按目标覆盖。

## 安全边界

- DeepSeek 只识别意图、生成解释并建议白名单组件；金额、日期、可行性、风险和动作参数由服务端确定性规则产生。
- 所有写操作继续使用服务端 `actionId`，并绑定用户、会话、参数、Twin Version、过期时间和幂等键。
- 未知或非法组件降级为无执行按钮的说明卡。
- 金额使用整数分，日期使用 ISO 格式；现有 SQLite 数据和历史组件必须保持兼容。

## 接口与类型

- 新增 `POST /api/agent/preview`。
- 新增 `GET /api/risk/summaries`、`POST /api/risk/summaries/ensure` 和 `POST /api/demo/weekly-summary`。
- 新增 `GoalAssumptions`、`GoalScenarioPreview`、`PlanStep`、`WeeklyRiskSummary` 和 `NotificationDelivery`。
- 扩展 `AgentComponent`、`AgentThread.kind`、`AgentTurn` 和 `Snapshot`。

## 非目标

- 不开发分类预算、消费饼图、消费评分或行为训导。
- 不发送短信、邮件或手机推送。
- 不连接真实银行或真实资金。
- 不部署公网，也不迁移到 assistant-ui。
