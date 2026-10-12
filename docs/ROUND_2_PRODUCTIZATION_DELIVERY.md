# 第二轮产品化交付说明

本轮把目标审批、安全审计、跨页面一致性和攻击演示从“展示概念”推进为可运行、可验证的闭环，同时补上部署侧的基础安全能力。

## 1. 创建 / 修改目标的真实审批 UI

- Agent 生成 `create_goal` 或 `update_goal` 草案后，前端先请求服务端创建 Approval Snapshot。
- 审批卡展示工具、权限、过期时间、Snapshot Hash 和被冻结的最终参数。
- 用户明确确认后，前端先调用 `confirm_approval`，再携带 Approval Token 执行实际写工具。
- 用户取消时不执行任何写操作；默认权限仍是 Recommend，不会自动划转资金。
- 创建或修改成功后，Financial Twin 版本递增，并写入用户可见活动记录。

## 2. Activity 真实审计接线

- Activity 页面进入时调用 `get_activity`，展示服务端审计事件，而非仅展示前端模拟数据。
- 每条记录包含事件类型、对象 ID、状态、Evidence Sequence、时间及元数据。
- 页面同时显示 Financial Twin 的业务活动，便于对照“业务状态变化”和“安全审计证据”。

## 3. 四页面状态一致性自动化验证

新增 `npm run verify:surfaces`。测试通过真实审批链路修改目标月度投入，随后校验：

- Today、Life、Twin、Activity 使用同一 Twin Version。
- 目标月度投入在 Twin 状态、Banking Tool 查询结果和 Activity 审计中一致。
- 单次操作能够被四个页面投影消费，而不是各页面维护独立假数据。

该验证已并入 `npm run eval:baseline`，成为架构基线的一部分。

## 4. 可操作的金额篡改攻击演示

安全后台新增真实攻击演示：

1. 为指定金额创建并确认 Approval Snapshot。
2. 保留原 Approval Token，但在执行前篡改月度投入金额。
3. 请求发送到真实 Banking Sandbox。
4. 页面展示服务端返回的拒绝代码和原因。

这证明金额变化会使原授权失效，拒绝发生在服务端，不能通过修改前端绕过。

## 5. Secret、限额、监控和日志脱敏

- 新增 `.dev.vars.example`，只提供变量名和安全默认值，不包含真实密钥。
- Agent 与 Banking Tools 的请求限额分别由 `NOVA_AGENT_RPM`、`NOVA_BANKING_RPM` 配置。
- 新增 `/api/health`，报告数据库、Provider、评测模式和 rollout 状态，不回传 Secret。
- 新增递归日志脱敏工具，覆盖 API Key、Authorization、Signature、Token、Secret、Approval Token 和 `sk-...` 格式值。
- Secret 应配置在本地未提交文件或部署平台 Secret 中，不能写入源码和 Git。

## 验证结果

- 前端 TypeScript / 生产构建通过。
- Goal Flow 场景：14 / 14 通过。
- Banking Sandbox 安全验证通过。
- Financial Twin 闭环验证通过。
- 四页面状态一致性验证通过。
- Agent shadow 与 phase4 rollout 基线通过。

## 尚需真实基础设施配置的事项

以下不是代码内可以凭空完成的工作，正式发布前仍需在部署平台配置和验收：

- 将 DeepSeek、外部 Agent 签名等密钥写入部署平台 Secret。
- 将进程内限流升级为跨实例的分布式限流存储。
- 接入真实日志平台、指标平台和告警接收渠道，并设置 SLO 与告警阈值。
- 在正式域名进行浏览器端、移动端、弱网和部署环境回归测试。
- 根据比赛演示脚本继续增强 Activity 的筛选、导出和证据包能力。

因此，本轮达到“可运行、可演示、可自动验证的 MVP 产品化闭环”，但不应表述为已经完成生产级基础设施上线。
