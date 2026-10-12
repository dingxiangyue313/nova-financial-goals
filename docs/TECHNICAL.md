# NOVA 技术说明（比赛演示版）

## 架构与边界

```
React 原版界面 ── same-origin /api ── Express 服务
                                   ├─ Zod 共享契约 / 白名单卡片
                                   ├─ 确定性目标与风险规则
                                   ├─ DeepSeek 可选解析 / 编排
                                   ├─ SQLite 会话、状态、审计
                                   └─ 受保护 /mcp 模拟工具
```

- 入口：`server/index.ts`。演示默认时钟为 `2026-09-21`；重置恢复固定夹具。
- 状态：`server/store.ts` 为每个签名 Cookie 建立独立 SQLite 会话。应用只有模拟账户；不导入真实银行数据。
- 契约：`shared/contracts.ts` 使用 Zod；金额均为整数分，日期是 `YYYY-MM-DD`。页面只把分转换为显示用元。
- 规则：`server/domain.ts` 计算资金余量、预测日期、三方案和显著影响；`server/tools.ts` 判断身份、类别、额度、到期日、余额、幂等性，再执行、验证、审计。受保护应急金不进入可用余额。
- 模型：`server/agent.ts` 调用 DeepSeek Chat Completions；只解析目标和排序已有 UI 卡片。模型不能写状态、生成工具参数或改变计算值。超时、无 Key、无效输出回退确定性模式。
- MCP：`server/mcp.ts` 使用 TypeScript SDK Streamable HTTP，在 `/mcp` 注册 `read_goal`、`request_simulated_payment`、`verify_simulated_operation`。与网页模拟请求共用 `evaluateExternalRequest`。

## 三条链路与状态矩阵

| 场景 | 输入 | 规则结果 | 页面/记录 |
| --- | --- | --- | --- |
| 创建目标 | 描述、金额、日期、保护额 | 草案；要求显式选择方案 | 创建页 → 可行性页 |
| 方案未选 | 激活 `null` | `PLAN_NOT_SELECTED` | 不激活 |
| 正常 | 可用月结余足够、历史数据 ≥2 月 | `on_track` | 首页按时预测 |
| 数据不足 | 历史数据 <2 月 | `insufficient_data` | 表明依据不足 |
| 不可行 | 目标所需月存高于可用额 | `infeasible` | 禁止不可行方案激活 |
| 小额波动 | 未改变计划投入或低于显著阈值 | 无影响信号 | 首页无紧急提醒 |
| 显著支出 | 投入出现缺口且达到阈值 | 影响与 A/B 方案 | 影响页，保护额不变 |
| 模型不可用 | 无 Key、超时或无效 JSON | 确定性回退 | 演示不中断 |
| 已授权同类请求 | 身份、额度、余额、期限均合格 | Execute | 模拟余额变动及凭证 |
| 异类但在额度内 | 已授权且需逐次同意 | Ask | 用户核对后确认 |
| 超限/身份不符/余额不足/过期 | 风险或权限不合格 | Block | 无余额变动，审计 |
| 重复请求 | 相同幂等键与参数 | 返回原凭证 | 不重复扣款 |
| 工具超时 | 模拟状态未知 | Unknown | 查询原操作，不重试扣款 |

显著阈值为单笔不少于 ¥500 或不少于目标剩余金额的 5%，且必须实际造成当月目标投入缺口。此阈值是演示假设，可在比赛答辩中解释，不代表真实理财建议。

## 核心 API

| 方法与路径 | 用途 |
| --- | --- |
| `GET /api/session` | 当前会话完整快照与经过服务端校验的卡片 |
| `POST /api/goal/interpret` | DeepSeek 或确定性自然语言解析 |
| `POST /api/goals`, `PATCH /api/goals/current` | 新建、修改目标草案 |
| `POST /api/goals/activate` | 明确选择后激活方案 |
| `POST /api/demo/expense`, `/api/demo/deposit` | 注入模拟支出/存入 |
| `POST /api/impact/decision` | 选择 A/B、稍后或忽略 |
| `POST /api/mandates`, `/api/mandates/revoke` | 创建、撤销模拟授权 |
| `POST /api/demo/agent-request` | 演示外部 Agent 请求 |
| `POST /api/operations/:id/approve`, `GET /api/operations/:id` | 逐次同意与查验 |
| `POST /api/demo/scenario`, `/api/demo/clock`, `/api/demo/reset` | 演示状态与时钟、重置 |
| `GET /api/ui/cards` | 可选模型重排白名单卡片 |
| `GET /api/health` | 健康检查 |

HTTP 写入默认检查 Origin，浏览器 Cookie 为 HttpOnly、SameSite=Lax，生产环境加 Secure。MCP 使用独立 Bearer 令牌绑定同一模拟会话。所有接口只适用于可信演示环境，公网使用建议加入口访问控制与速率限制。

## 项目来源与版本

原版视觉来源：本仓库 `main@805a0f6`。本分支为独立重建；未导入旧 PR #1 或队友项目代码。`PRODUCT.md` 从用户维护的本地产品基线同步，Qwen 提法按最终选择更新为 DeepSeek。
