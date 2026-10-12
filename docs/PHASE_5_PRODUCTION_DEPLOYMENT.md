# 阶段 5：生产部署与演练

本仓库当前由 Codex Sites 托管的 Cloudflare Worker 承载，`frontend/.openai/hosting.json` 声明 `DB` binding。发布平台、真实域名与告警接收方必须由平台控制面配置；仓库代码不能证明它们已生效。项目是模拟 Banking Sandbox，禁止将其宣称为真实银行服务。

## 发布前门禁

1. 确认正式域名、DNS 所有权、TLS 证书、发布权限、D1 数据库 ID 和备份策略。正式域名必须经过可信身份网关；当前 `oai-authenticated-user-id` 只在可信网关注入时才可作为身份，直接公开 Worker 会允许请求者伪造此 Header。`x-nova-sandbox-session` 也仅用于演示环境。未解决身份边界前，不得公开用户数据接口。
2. 在平台 Secret 管理器中设置至少 32 字符的随机 `EXTERNAL_AGENT_SIGNING_SECRET`，以及按需设置 `DEEPSEEK_API_KEY`、`QWEN_API_KEY`。不得将值放进 Git、构建变量日志或工单。普通配置 `NOVA_AGENT_ROLLOUT=shadow`、`NOVA_EVALUATION_MODE=disabled`、`NOVA_AGENT_RPM=8`、`NOVA_BANKING_RPM=60`、`NOVA_MCP_RPM=30`。生产首次发布从 `shadow` 开始。
3. 在目标 D1 上先应用 `backend/drizzle/0000_many_joshua_kane.sql`（若尚未应用），再应用 `backend/drizzle/0001_rate_limits.sql`。记录数据库 ID、迁移时间和操作者。迁移前升级应用会使写接口以 503 拒绝请求。
4. `npm run build`、`npm run lint` 和本地回归通过后，发布不可变版本并记下版本 ID。不要把本地 `.dev.vars` 当作平台 Secret。
5. 从正式域名访问 `GET /api/health`，必须为 200，且 `database`、`rateLimitStorage`、`externalAgentSigning` 均为 true。访问 `GET /api/banking-tools/health` 检查 Banking Sandbox。对每个写接口执行一次受控 smoke test，并核对 `x-nova-request-id` 与平台日志。

## 限流与观测

`/api/agent` 与 `/api/goal-flow` 共享 Agent 桶，`/api/banking-tools` 与 `/api/financial-twin` 共享 Banking 桶，`/api/mcp` 使用独立桶。POST 请求使用 D1 原子计数，以每分钟、客户端 IP 和桶类型为键，所有 Worker 实例共享。无 D1 或查询失败时返回 503，超限返回 429 与 `Retry-After`。上线后从两个独立 Worker 实例/地区并发发起超过限额的受控请求，确认总成功数不超过限额；不要只用单实例测试证明跨实例行为。限流表按概率清理一小时前的窗口。

应用记录 JSON 日志：`event`、`requestId`、`operation`、`status`、`durationMs`、`outcome`、`timestamp`，不记录请求体、账户标识或 Secret。将 Worker 日志接入平台日志服务，设置保留期与访问控制。仪表盘至少展示每分钟请求量、429/5xx 比例、p95 延迟、健康探针成功率、D1 错误数、Agent fallback 比例及 MCP 签名失败数；后两项需从现有业务审计记录和平台日志汇总。核对这些数据确实来自生产流量，不能用静态健康页面代替。

建议告警：健康探针连续 3 次失败；5 分钟 5xx 比例超过 2% 且请求数不少于 20；p95 延迟连续 10 分钟超过 3 秒；429 比例 5 分钟超过 10%；MCP 签名失败或重放事件突增。每条告警绑定值班接收方和升级路径，发送测试告警并记录收到的时间。阈值是初始值，应依据真实基线调整。

## Secret 轮换与泄漏

- Provider Key：先在 Provider 创建新 Key，放入平台 Secret，发布新版本，验证 API 调用与 fallback 指标，再撤销旧 Key。不要在日志中打印值。
- `EXTERNAL_AGENT_SIGNING_SECRET`：当前协议只有单密钥校验，轮换需要协调所有外部 Agent，在短维护窗口切换 Secret 与客户端签名配置。切换时暂停 MCP 写调用，完成后验证有效签名成功、旧签名失败、重放失败。若需要无中断轮换，应先实现带 key ID 的双密钥验证协议。
- 发现泄漏：立即停止受影响的 MCP 调用或 Provider 调用，撤销泄漏 Key，发布新 Secret，检查平台访问日志和 `nova_audit` 中异常调用，保存证据并通知值班负责人；按组织要求评估用户通知。不要仅删除 Git 中的明文，必须在上游撤销。

## 故障注入与回滚演练

在隔离的预发布环境执行，记录时间、版本、操作者与恢复时长：

1. 移除或禁用测试 D1 binding：写接口应返回 503，健康探针应返回 503，告警应到达。
2. 将测试环境限流阈值设为 2，在两个实例并发请求 3 次以上，确认 429、`Retry-After` 与日志关联。
3. 将 Provider Key 临时设为无效测试值，确认 Agent 安全 fallback，不发生资金工具越权。
4. 将 `NOVA_AGENT_ROLLOUT` 改为 `shadow`，确认用户流量走基线；如需完整版本回滚，使用平台上一个已知良好的部署版本回退。数据库迁移是向后兼容的，回滚应用时保留限流表，避免回滚过程丢失计数。回滚后重跑健康探针与 smoke test。

发布记录应附上：正式域名、部署版本 ID、迁移结果、Secret 配置检查（只记存在与否）、监控链接、告警测试回执、故障注入结果、回滚版本和恢复时长。缺少这些证据时，阶段 5 仍处于待验收状态。
