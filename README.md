# NOVA — 目标驱动的主动式 AI 财务副驾驶

> **不用记账，也知道目标能不能按时实现。**

这是比赛演示版。它保留原版 NOVA 的 React/Vite 界面，并加入以对话为主入口的 Generative UI 工作台：用户用自然语言描述任务，NOVA 在对话中组合经过校验的目标、方案、影响、授权和凭证卡片，用户确认后才执行。Express、TypeScript 与 SQLite 服务提供目标可行性、显著支出影响和受控模拟 Banking-as-Tools。**不接真实银行、不转真实资金。**

工作台支持多个长期会话、未读风险会话、重命名、归档、恢复和删除。刷新或重启服务后仍可查看历史；重置演示会创建新一轮数据，旧会话保留为只读历史。

产品定位与完整需求见 [PRODUCT.md](PRODUCT.md)。技术契约与流程见 [技术说明](docs/TECHNICAL.md)。

## 三条演示流程

1. **目标规划**：自然语言创建目标 → 首次选择银行卡、微信支付和支付宝模拟来源 → 自动读取近 90 天流水 → 修改金额、日期、月投入、保护资金和浮动周数 → What-if 只读试算 → 比较三种以内方案 → 确认应用并激活。没有选择方案时不能激活。
2. **目标感知风险**：激活计划时确认智能守护设置。NOVA 自动整理模拟流水；普通趋势进入每周安静摘要，累计变化真正影响目标时才建立未读风险会话，应急金保持隔离。
3. **外部 Agent**：在“我的 → 授权与执行记录”创建限额、类别、有效期授权，分别模拟 Execute、Ask、Block、Manual Review 和 Unknown；随后在“动态”页展开请求、判断、确认、执行、Receipt、余额变化和 Hash 审计链。Manual Review 必须通过系统 Passkey 设备验证。

三条流程也可从底部 **NOVA** 工作台用自然语言完成：

- `我想年底去日本旅行，预算 ¥8,000`
- `这笔 ¥900 支出会影响目标吗？`
- `允许旅行 Agent 在 ¥500 内订票`

后端还提供版本化 Financial Twin、一次性 Approval Token、模拟转账、换汇报价与执行、Mandate 生命周期、HMAC 签名和 Nonce 防重放、受限 MCP、结构化日志，以及 JSON/CSV 审计证据导出。

模拟连接只提供读取权限，不创建扣款、转账或外部 Agent 授权。首次连接立即导入三个月历史；应用打开、回到前台及保持打开期间会自动检查新批次，重复检查不会重复入账。“我的 → 数据连接与自动守护”可查看来源、覆盖范围、更新时间并停止后续同步，历史依据和审计仍会保留。

目标感知风险演示位于顶部“模拟数据”面板。连接来源并激活目标后，先推进到 9 月 22 日观察普通趋势进入安静摘要，再推进到 9 月 23 日观察外卖与打车由过去两个 30 天窗口平均 ¥600 增至本期 ¥1,900。当日本旅行预计延期约 16 天后，NOVA 才建立未读风险会话。它不会拦截用户自己的银行卡消费；只有由 NOVA 或外部 Agent 经过 Banking Tools 发起的模拟操作，才会得到 Execute、Ask、Manual Review 或 Block。

工作台在手机端使用单列消息流，在自适应桌面端使用约 32% 对话区与 68% Governed Canvas。每周摘要按亚洲上海时区的自然周去重，不显示紧急红点；用户可设置摘要开关、金额阈值、目标占比阈值、暂停日期、静默时间和当前目标覆盖。

金额在服务端统一用整数分，日期使用 ISO 格式。目标进度、预测、权限和执行结果由确定性规则计算。DeepSeek 只识别意图、解析自然语言目标并生成短解释；组件、金额和 `actionId` 由服务端白名单与规则引擎生成。未设置 Key、超时、输出无效或检测到 Prompt Injection 时自动回退，演示流程仍可完成。

## 本地打开

需要 Node.js **22.13 或更新版本**和 npm。仓库目前为私有；队友应先接受 GitHub 协作者邀请。

```bash
git clone https://github.com/dingxiangyue313/nova-financial-goals.git
cd nova-financial-goals
cp .env.example .env
npm ci
npm run dev
```

浏览器打开终端显示的地址，默认是 [http://localhost:3000](http://localhost:3000)。若端口已占用，可运行 `PORT=3001 npm run dev`。`.env` 中的 `DEEPSEEK_API_KEY` 可留空，确定性模式即可完整演示。只有真实使用 DeepSeek 解析和卡片编排时才填写自己的 Key；Key 不应发送给队友或提交到 GitHub。`.env` 已加入 `.gitignore`。

本地设备验证默认使用 `NOVA_RP_ID=localhost` 和 `NOVA_ORIGIN=http://localhost:3000`。部署公网或手机访问时必须使用 HTTPS，并把这两个值改为实际域名和完整 HTTPS 来源。NOVA 只保存凭据 ID、公钥、计数器和 transports，不读取或保存 Face ID、Touch ID、指纹或设备密码。

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | Express + Vite 同源开发服务 |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 运行生产构建，需先设置 `NOVA_SESSION_SECRET` |
| `npm run lint` | TypeScript 类型检查 |
| `npm test` | 服务端、治理、安全和确定性规则检查 |
| `npm run test:properties` | 金额、保护资金、幂等、风险优先级和审计链属性测试 |
| `npm run eval:promptfoo` | 不调用真实模型的意图、注入攻击与回退评测 |
| `npm run test:a11y` | 三种屏幕尺寸的严重无障碍问题检查 |
| `npm run test:e2e` | 用 Chrome 在 360、768、1440 px 跑固定页面与对话工作台主流程 |

Playwright 按产品叙事分别验收：

- 目标可行性：未选择方案不能激活，选择后可激活并在刷新后保留。
- 目标影响监测：小额波动保持安静，显著支出触发解释与调整。
- 目标感知趋势：验证 30 天窗口、证据门槛、16 天延期、去重、忽略抑制和体验者隔离。
- 受控自主执行：同一限定授权分别产生 Execute、Ask、Manual Review 与 Block，并留下凭证和 Hash 链审计。
- 对话工作台：长期会话可恢复；显著支出自动建立未读风险会话；所有写操作先展示确认卡。

`.github/workflows/ci.yml` 会在更新 `main` 的 Pull Request 和提交到 `main` 后自动运行密钥扫描、依赖安全检查、类型检查、服务端与属性测试、Promptfoo 评测、生产构建、无障碍检查和以上故事验收。CI 固定使用确定性模式，不读取 DeepSeek Key。采用工具、固定版本、许可证与运行边界见 [通用能力复用说明](docs/COMMON_CAPABILITIES.md)。

生产模式本地验证：

```bash
npm run build
NOVA_SESSION_SECRET="$(openssl rand -hex 32)" npm start
```

`/api/health` 提供健康检查。SQLite 默认保存在 `data/nova.sqlite`，该目录不会提交。字体与部分图片来自外部链接，离线时可能缺失。

## 线上部署

部署材料见 [部署说明](docs/DEPLOYMENT.md)、[Dockerfile](Dockerfile)、[compose.yaml](compose.yaml) 和 [Nginx 示例](docs/nginx.nova.conf.example)。线上需要独立密钥、持久化 SQLite 目录与 HTTPS。当前仓库提交的是部署配置；正式线上地址应在服务器配置与验收完成后填写。

## 接口与安全

- `/api/session` 提供同一体验者的页面快照。Cookie 签名且只供本站使用。
- `/api/agent/threads`、`/api/agent/turn`、`/api/agent/preview`、`/api/agent/action` 提供长期会话、完整生成回合、只读 What-if 预览和受控确认动作；旧 `/api/agent` 保留为兼容入口。
- `/api/financial-twin`、`/api/goal-flow`、`/api/banking-tools` 是 Twin、目标状态机与工具入口；原页面 API 保留为兼容封装。
- `/api/activity`、`/api/audit/export?format=json|csv` 提供可验证活动和证据导出。
- `/api/risk/preferences`、`/api/risk/signals`、`/api/risk/summaries` 提供智能守护偏好、趋势证据、即时目标影响和安静周摘要；`POST /api/risk/summaries/ensure` 会幂等检查本周摘要。
- `/api/data-connections` 提供模拟来源状态；`connect`、`sync/ensure` 和 `:source/revoke` 分别处理首次连接、幂等自动同步和停止未来同步。
- `/api/demo/clock` 只推进比赛演示时钟；新流水由已连接来源自动出现，页面不提供手工注入流水按钮。
- `/api/external-agent/request` 要求 HMAC 签名、5 分钟时间窗口和一次性 Nonce。
- `/mcp` 是需要会话令牌的 MCP Streamable HTTP 入口，只暴露白名单模拟工具。令牌由 `/api/mcp/token` 在当前浏览器会话内获取，不是 DeepSeek Key；不要公开分享。
- Helmet 为浏览器响应设置安全头；普通 API 每分钟最多 180 次请求，Agent 与模型相关入口每分钟最多 30 次。Pino 日志隐藏 Cookie、Authorization、签名、请求正文、API Key 和完整账户标识。

安全边界与已知限制见 [安全自评](docs/SECURITY_SELF_ASSESSMENT.md)。本项目只用于演示，不应存放真实金融账户或真实支付凭据。

## 选择性复用来源

本分支保留 `main@805a0f6` 的原版 NOVA 视觉与交互。经双方授权，后端能力与测试场景选择性参考 `Amy-Lin365/NOVA-AI-Banking-Agent@ca1124c` 的契约、状态机、安全规则和测试思想，并使用本仓库的 Express、TypeScript、SQLite 架构重新实现；未复制其前端，也未合并旧集成 PR #1。
