# 阶段 3：真实安全控制台

## 交付目标

本阶段把原先偏展示性质的安全卡片改造成由服务端 Banking Sandbox 实际执行、可查询、可追溯、可导出的安全验证台。前端只负责发起场景与展示结果，不自行决定放行或拒绝。

## 已完成能力

- 重放攻击：第一次请求完成审批与执行，第二次复用相同 nonce 时由服务端返回 `REPLAY_DETECTED`。
- 过期 Mandate：使用真实过期时间窗口创建 Mandate，请求由服务端返回 `MANDATE_EXPIRED`。
- 外部 Agent 无效签名：请求进入真实 HMAC 校验，错误签名返回 `AGENT_SIGNATURE_INVALID`。
- 高风险人工复核：高金额请求进入风险规则并返回 `MANUAL_REVIEW_REQUIRED`，不会直接执行。
- 工具超时：创建状态为 `unknown` 的真实 Operation；后续只能使用原 Operation ID 查询状态，不把超时误报为失败或成功。
- 全链路关联：每次演示生成 Trace ID，并关联 Request、Decision、Approval、Operation 与 Receipt。
- 审计证据导出：支持 JSON 与 CSV；JSON 包含报告哈希，事件包含前序哈希和事件哈希，可用于验证审计链完整性。

## 运行链路

1. 前端调用 `run_security_scenario`，服务端生成 Trace ID 和 Request ID。
2. 服务端根据场景创建真实 Mandate、签名请求、风险决策或超时 Operation。
3. 需要执行的重放场景会经过 Decision、Approval Snapshot、用户确认令牌、Operation 和 Receipt。
4. 服务端写入 `security_demo_started` 与 `security_demo_completed` 审计事件。
5. 前端用 `get_security_trace` 读取同一 Trace 下的链路与事件；超时场景再用原 Operation ID 调用 `get_operation_status`。
6. `export_audit_report` 导出比赛可核验的审计证据。

## 边界说明

这里的“真实”是指安全判断、状态转换、幂等、签名、审批、审计与查询均在服务端 Banking Sandbox 中真实执行，不是前端写死结果。它仍然不是微众银行生产系统，也不移动真实资金；接入真实银行工具后可保持相同协议替换执行适配层。

## 验证命令

```bash
npm run build
npm run verify:stage3
npm run eval:baseline
```

自动化覆盖五个攻击/异常场景、原 Operation ID 查询、五段链路关联及防篡改审计导出。
