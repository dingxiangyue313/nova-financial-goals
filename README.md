# NOVA — 目标驱动的主动式 AI 财务副驾驶

> **不用记账，也知道目标能不能按时实现。**

这是比赛演示版。它保留原版 NOVA 的 React/Vite 手机界面，由本仓库新建的 Express、TypeScript 与 SQLite 服务提供目标可行性、显著支出影响和受控模拟 Banking-as-Tools。**不接真实银行、不转真实资金。** 每位体验者有独立的演示会话；刷新页面会保留该会话状态，使用“模拟数据 → 重置”才会恢复初始数据。

产品定位与完整需求见 [PRODUCT.md](PRODUCT.md)。技术契约与流程见 [技术说明](docs/TECHNICAL.md)。

## 三条演示流程

1. **目标规划**：创建或修改目标 → 比较三种节奏 → 明确选择方案 → 激活计划。没有选择时不能激活。
2. **目标影响**：激活计划后模拟小额与显著支出。小额波动不触发提醒；显著变化才解释目标影响和两个调整选项，应急金保持隔离。
3. **外部 Agent**：在“我的 → 授权与执行记录”创建限额、类别、有效期授权，分别模拟 Execute、Ask、Block、身份不符和超时；查看凭证与审计，并可撤销授权。

金额在服务端统一用整数分，日期使用 ISO 格式。目标进度、预测、权限和执行结果由确定性规则计算。DeepSeek 只参与自然语言目标解析和白名单卡片编排；未设置 Key、超时或输出无效时自动回退，演示流程仍可完成。

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

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | Express + Vite 同源开发服务 |
| `npm run build` | 构建前端到 `dist/` |
| `npm start` | 运行生产构建，需先设置 `NOVA_SESSION_SECRET` |
| `npm run lint` | TypeScript 类型检查 |
| `npm test` | 确定性规则检查 |

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
- `/api/goals`、`/api/goals/activate`、`/api/demo/expense`、`/api/impact/decision` 组成目标主链路。
- `/api/mandates`、`/api/demo/agent-request`、`/api/operations/:id` 提供受控模拟执行与凭证。
- `/mcp` 是需要会话令牌的 MCP Streamable HTTP 入口，只暴露白名单模拟工具。令牌由 `/api/mcp/token` 在当前浏览器会话内获取，不是 DeepSeek Key；不要公开分享。

安全边界与已知限制见 [安全自评](docs/SECURITY_SELF_ASSESSMENT.md)。本项目只用于演示，不应存放真实金融账户或真实支付凭据。
