# Phase 16 — Banking Sandbox / MCP

## 交付结论

Phase 16 已形成独立的受治理银行工具服务。REST 与 MCP 共用一套 Zod Contracts、运行时、D1 数据和安全规则；第三方 Agent 不能绕过第一方用户确认。

## 服务入口

- `GET /api/banking-tools`：服务状态、架构能力和完整第一方工具目录。
- `GET /api/banking-tools/health`：D1、Contracts 与外部 Agent 签名配置就绪检查。
- `POST /api/banking-tools`：第一方 REST 工具调用。
- `GET /api/mcp`：MCP 服务信息。
- `POST /api/mcp`：JSON-RPC 2.0 的 `initialize`、`tools/list` 和 `tools/call`。

## 身份与用户隔离

第一方 REST 调用优先使用平台注入的 `oai-authenticated-user-id`。本地概念测试必须显式传 `x-nova-sandbox-session`，服务端将它 HMAC 映射为隔离的 sandbox user id；不再把所有匿名调用放进共享的 `demo-public`。

所有 `nova_records`、`nova_operations` 和 `nova_audit` 查询都带 `user_id` 条件。幂等唯一键为 `(user_id, idempotency_key)`，一个用户不能读取或消费另一个用户的 Approval、Operation、Mandate 或审计事件。

## MCP 外部 Agent 调用协议

`tools/list` 可公开发现，但 `tools/call` 必须包含：

- `x-nova-agent-id`
- `x-nova-resource-owner`
- `x-nova-timestamp`：ISO 时间，允许偏差 5 分钟
- `x-nova-nonce`：至少 16 字符且只能使用一次
- `x-nova-signature`：64 位十六进制 HMAC-SHA256

签名对象采用稳定键排序序列化：

```json
{
  "agentId": "agent_wandermate_001",
  "resourceOwner": "user_001",
  "timestamp": "2026-09-23T10:00:00.000Z",
  "nonce": "unique-random-nonce",
  "body": { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {} }
}
```

服务端使用 `EXTERNAL_AGENT_SIGNING_SECRET` 验签。验签后立即把 nonce 作为已消费记录写入 D1；重复 nonce 返回 `AGENT_REPLAY_DETECTED`，工具不会再次运行。

MCP 只公布外部 Agent 所需的查询、规划、请求评估与外部支付工具。`confirm_approval`、创建/修改 Mandate、直接转账、审计写入等第一方能力不会出现在外部目录中。

## 幂等执行

所有最终写工具接收 `idempotencyKey`。第一次执行会保存：

- Operation ID
- user id
- tool name
- idempotency key
- input hash
- status 与完整结果

相同用户、相同 key、相同参数返回原结果；相同 key 但参数变化返回 `IDEMPOTENCY_CONFLICT`。Approval Token 通过条件更新从 `active` 原子改为 `consumed`，重复消费返回 `APPROVAL_REPLAY_DETECTED`。

Operation 现在先依赖数据库唯一索引原子插入 `processing` 占位，再进入 Permission/Risk/执行步骤，消除了并发请求同时通过“先查询、后写入”的窗口。成功或失败都会写回同一个 Operation；外部支付决策也会从 `execute/ask` 原子改为 `executed`，即使攻击者更换幂等键也不能重复消费同一个决策。

## 服务端治理

资金与状态写入在服务端完成：

1. Zod 输入校验。
2. 用户或 Agent 身份验证。
3. Approval Snapshot 或 Mandate Permission。
4. 快照、余额、安全资金、高风险、重复执行 Risk。
5. 工具执行或阻断。
6. Operation/Receipt 持久化。
7. Audit 事件写入。

模型只能提出工具调用，不能签发 Approval Token。MCP 上下文永远使用 `userConfirmed=false`。

工具作用域同时在 MCP 路由和 Banking Runtime 两层检查。即使未来路由配置错误，`external_agent` 仍不能越权调用第一方写工具。

## 自动化验收

保持本地服务运行后执行：

```bash
npm run verify:banking
```

脚本验证服务发现、未认证拒绝、用户隔离、审批权限、幂等重放、幂等冲突、审计持久化、MCP 工具作用域和 MCP 强制认证。

## 沙箱边界

这是比赛概念服务：账户、余额、交易、支付和换汇仍是模拟数据，不连接微众银行生产系统。生产接入还需要正式 OAuth/OIDC、Agent 注册与密钥轮换、真实风控/账务适配器、mTLS 或网关认证、监控告警和合规审批。
