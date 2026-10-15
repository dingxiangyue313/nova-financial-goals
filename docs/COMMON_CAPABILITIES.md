# 通用能力复用说明

NOVA 保留目标可行性、目标影响、Financial Twin、Mandate、Approval、风险策略和审计链等产品核心。以下成熟工具只承担通用基础能力，不参与金额计算或金融决策。

| 能力 | 采用方案 | 固定版本 | 许可证 / 使用条件 |
| --- | --- | --- | --- |
| HTTP 安全响应头 | Helmet | 8.3.0 | MIT |
| API 限流 | express-rate-limit | 8.7.1 | MIT |
| 结构化日志 | Pino | 10.4.0 | MIT |
| 规则属性测试 | fast-check | 4.10.2 | MIT |
| 无障碍测试 | @axe-core/playwright | 4.13.0 | MPL-2.0，仅开发测试 |
| 模型与回退评测 | Promptfoo | 0.124.1 | MIT，通过固定版本的隔离命令运行 |
| 密钥扫描 | Gitleaks Action | v3 提交 `e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e` | 个人 GitHub 账号无需许可证密钥；组织账号需要按其条款配置 |

依赖由 `package-lock.json` 固定，团队安装使用 `npm ci`。GitHub Actions 本身也固定到完整提交 SHA，避免标签移动后静默改变构建环境。

## 运行边界

- Helmet 的 CSP 只允许本站脚本与 API，并为现有 Google Fonts、Unsplash 和 Google 图片声明资源白名单。
- 普通 API 按 IP 与演示会话限制为每分钟 180 次；Agent、DeepSeek 和外部请求限制为每分钟 30 次。可通过服务器环境变量降低阈值。
- Pino 记录请求编号、路径、状态码和耗时，不记录请求正文、Cookie、Authorization、签名、API Key 或完整账户标识。
- DeepSeek 调用统一经过服务端客户端，使用 12 秒超时、Zod Schema、Prompt Injection 检测和确定性回退。
- Promptfoo 在 CI 中不调用真实模型，也不读取 `DEEPSEEK_API_KEY`。
- Gitleaks 检查完整 Git 历史和当前改动；发现真实密钥时必须先撤销并轮换密钥，再处理 Git 历史。

## 自动检查

```bash
npm run lint
npm test
npm run test:properties
npm run eval:promptfoo
npm run build
npm run test:a11y
npm run test:e2e
```

完整端到端测试覆盖 360、768、1440 像素。无障碍检查覆盖首页、对话工作台、可行性、目标影响和授权记录页面，并阻止严重或致命的 WCAG A/AA 问题进入主分支。

## 暂不替换的能力

- `assistant-ui` 保留为未来实验选项。比赛版本继续使用现有工作台，以保留 NOVA 视觉、长期会话、服务端 `actionId` 和移动端表现。
- `Casbin` 不替换目标感知金融规则。权限、目标影响和保护资金需要共享同一个 Financial Twin 与确定性决策顺序。
- `Actual Budget` 等分类预算工具与“不用记账，也知道目标能不能按时实现”的定位不一致。

