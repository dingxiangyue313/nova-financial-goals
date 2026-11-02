# NOVA

### 目标驱动的主动式 AI 财务副驾驶

**不记账，也有数。**

NOVA 从你想完成的生活目标出发，把模拟账户、流水和资金约束转化为可解释的行动计划：**目标能否按时实现？变化会带来什么影响？最少需要调整什么？**

用自然语言说出旅行、学费或应急金目标，NOVA 帮你核对条件、比较存钱节奏，并在变化真正影响目标时提醒。每次调整都有依据，涉及模拟资金的操作有明确授权、执行结果和审计记录。

> 当前版本用于产品与比赛演示。所有银行连接、余额、订单和资金操作均为模拟，不连接真实银行、不转移真实资金。

[快速开始](#快速开始) · [体验流程](#体验流程) · [技术架构](#技术架构) · [开发与验证](#开发与验证) · [项目文档](#项目文档)

## 产品能力

| 能力 | 你可以做什么 |
| --- | --- |
| 自然语言目标规划 | 描述目标，补充或修改预算、已存金额、日期和月投入上限；缺失条件会追问 |
| 可解释的候选方案 | 比较月投入、首月安排、预计完成日期、资金余量与适用说明；查看完整计算依据 |
| GoalGuard 智能守护 | 区分普通波动与真正影响目标的变化，提供安静摘要或可处理的风险提醒 |
| 目标影响与修复 | 核对支出证据，比较保持目标日期或保持月投入的方案，确认后原子更新计划 |
| 连续财务任务 | 从合成账单分析、订阅处理到方案比较、工资到账后的转入安排，持续推进旅行目标 |
| 模拟金融服务 | 体验目标资金、转账与 AA、理财、卡片、旅行请求和账单订阅等场景 |
| 长期对话工作台 | 会话可恢复、重命名、归档与继续；任务状态、候选结果和执行记录可追踪 |
| 授权与执行证据 | 限定授权、逐次确认、状态查询、凭证与审计导出；状态未知时查询原操作 |
| PWA 与离线摘要 | 安装到主屏幕；离线查看最近摘要，暂停同步、授权及写操作 |

界面保留 NOVA 的青绿色视觉、底部导航和手机框模式。手机使用单列对话，自适应桌面工作台支持对话区与任务画布并排展示。

## 快速开始

### 运行环境

- Node.js **22.13 或更新版本**，以及 npm。
- 访问私有仓库时，需要拥有相应 GitHub 权限。
- DeepSeek Key 为可选配置：不配置也能通过确定性回退体验核心演示流程。

```bash
git clone https://github.com/dingxiangyue313/nova-financial-goals.git
cd nova-financial-goals
npm ci
```

复制环境变量模板：

```powershell
# Windows PowerShell
Copy-Item .env.example .env
```

```bash
# macOS / Linux
cp .env.example .env
```

启动前后端同源开发服务：

```bash
npm run dev
```

打开终端输出的地址，默认是 **[http://localhost:3000](http://localhost:3000)**。开发服务同时提供页面和 API，不需要另开前端端口。

端口占用时：

```powershell
# Windows PowerShell
$env:PORT = '3001'
npm run dev
```

```bash
# macOS / Linux
PORT=3001 npm run dev
```

如需使用设备验证，请同时将 `.env` 中的 `NOVA_ORIGIN` 改为对应来源，例如 `http://localhost:3001`。

### 配置说明

| 环境变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 可选，仅服务端使用；留空启用确定性回退 |
| `DEEPSEEK_MODEL` | 模型名称，模板默认 `deepseek-flash` |
| `PORT` | 服务端口，默认 `3000` |
| `NOVA_DB_PATH` | SQLite 路径，模板为 `./data/nova.sqlite` |
| `NOVA_SESSION_SECRET` | 生产必填，至少 32 个字符的独立随机值 |
| `NOVA_EXTERNAL_AGENT_SECRET` | 外部 Agent 请求的 HMAC 签名密钥 |
| `NOVA_RP_ID` / `NOVA_ORIGIN` | Passkey 的域名与完整来源，本地默认 `localhost` 与 `http://localhost:3000` |
| `NOVA_DEMO_CONTROLS` | 生产环境是否开放演示控制；开发环境默认提供演示能力 |
| `NOVA_ENABLE_DEMO_CONTROLS` | 单独控制 AI 安全模式演示入口 |
| `NOVA_ALLOW_STATEMENT_UPLOAD` | 是否允许账单上传，默认关闭；仍可使用内置合成样例 |

**不要提交 `.env`、真实密钥、真实账户信息或数据库文件。** 配置模型时只在本机或部署平台的服务端环境中填写自己的 Key。

## 体验流程

### 1. 创建目标并核对方案

进入底部 **NOVA**，尝试输入：

> 我想在 2027 年 7 月 31 日去韩国旅行，预算 4,000 元，已存 0 元，每月最多存 1,000 元。

1. 核对目标、预算、已存金额和日期；信息不完整时继续补充。
2. 按页面引导连接银行卡、微信支付或支付宝模拟来源。
3. 查看候选方案的月投入、完成日期、首月安排、适用说明和计算依据。
4. 选择方案，核对确认后再启用目标计划。

未选择方案不能直接激活。试算不会修改账户；启用目标计划也不等于授权自动转账。若日期早于当前模拟日期，NOVA 会提示修改日期，保留其他已填条件。

### 2. 查看一笔确实影响目标的支出

在开放演示能力的环境中，点击顶部 **支出影响案例**：

- 载入独立的日本旅行案例账户，原账户保留。
- 案例记录 **¥900 汽车保养支出**，服务端重新计算目标影响。
- 当前固定案例中，每月投入 **¥1,500** 时，预计完成日期从 **2026-12-15** 延至 **2026-12-23**，延期 **8 天**。
- 方案 A 核算为每月投入 **¥2,000**；方案能否采用取决于服务端校验，不可行方案会禁用并说明原因。
- 选择并确认后更新案例账户中的目标计划，刷新仍保留，审计记录可追溯。
- 点击 **返回原账户**，恢复此前的模拟账户。

这些数字仅属于该固定案例。其他目标的影响、日期与方案均根据对应模拟数据重新计算。修改计划不会自动修改既有转入安排，需要另行核对。

### 3. 完成旅行连续任务

从首页进入日本旅行 Money Mission：

`导入合成样例 → 核对账单与证据 → 处理订阅 → 比较方案 → 确认转入安排 → 监测与跟进`

金额与阶段由服务端读模型提供。取消、拒绝、失败和状态未知会保留各自状态；未知操作通过原操作编号查询，避免重复执行。

### 4. 演示治理与安全

开发环境可打开 **`/demo-control`**，载入样例、推进模拟日期并观察目标风险。授权与执行场景可演示 Execute、Ask、Block、Manual Review 和 Unknown；Manual Review 使用 Passkey 设备验证。

普通流水变化不会被解释为“拦截用户消费”。只有经 NOVA 或外部 Agent 发起的模拟工具操作才经过执行权限判断。

## 技术架构

```text
React + Vite + Tailwind CSS
         │ 同源 API
Express + TypeScript
         ├── 共享 Zod 契约与服务端读模型
         ├── 目标预测、候选搜索与 GoalGuard 风险修复
         ├── 对话任务、只读调查与可解释组件
         ├── 授权、风险、模拟执行、验证与审计
         ├── 可选 DeepSeek 意图理解与解释
         └── SQLite 持久化
```

- **金额与日期**：金额统一使用整数分；日期使用 ISO 格式。界面在展示边界转换为元。
- **共享状态**：账户、目标、订单与工具结果从版本化状态读取，页面不自行编造财务结论。
- **模型边界**：模型辅助理解意图、选择受限只读工具和生成解释；金融计算、参数校验及执行授权由服务端确定性逻辑控制。
- **确认与幂等**：审批绑定动作、参数、版本和有效期；一次性 Token 与幂等键限制重复执行。
- **持久化与隔离**：SQLite 保存模拟状态、长期会话、候选证据、凭证与审计；会话通过签名 Cookie 隔离。
- **外部能力**：HMAC、时间窗口与 Nonce 防重放；MCP 仅开放受限白名单工具，不能自行批准资金操作。

```text
src/                页面、组件、客户端 API 与离线体验
server/             API、领域计算、对话、治理、模拟工具与持久化
shared/             前后端共享类型、Zod 契约与业务协议
tests/e2e/          Playwright 产品流程与无障碍验收
scripts/            测试执行、模型评测与演示验证脚本
docs/               技术、安全、部署和阶段交付说明
.github/workflows/  GitHub Actions 验证流程
```

## 开发与验证

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Express + Vite 开发服务 |
| `npm run lint` | TypeScript 类型检查 |
| `npm test` | 服务端、领域规则、授权、安全及属性等测试 |
| `npm run test:properties` | 单独运行金额、幂等与审计等属性测试 |
| `npm run eval:promptfoo` | 无真实模型调用的意图、注入与回退评测 |
| `npm run build` | 生成前端与 PWA 生产构建 |
| `npm run test:e2e` | Chrome 浏览器产品流程回归 |
| `npm run test:a11y` | 无障碍专项检查 |

首次运行浏览器测试前安装 Chrome：

```bash
npx playwright install chrome
npm run test:e2e
```

Playwright 覆盖 **360、768、1440 px**。CI 在面向 main 的 PR 与 main 更新时执行密钥扫描、依赖安全检查、类型检查、服务端测试、Promptfoo、构建与三组浏览器回归。真实模型评测是单独流程，不属于这些确定性检查。

健康检查：`GET /api/health`。核心接口包括 `/api/session`、`/api/agent/*`、`/api/money-mission`、`/api/impact/plan-*`、`/api/banking-tools` 与 `/api/audit/export`。完整说明见技术文档。

## 部署与运行边界

部署参考 [部署说明](docs/DEPLOYMENT.md)、[Dockerfile](Dockerfile) 和 [compose.yaml](compose.yaml)。部署需要 HTTPS、独立密钥和持久化 SQLite 存储；本仓库不预设已经上线的公网地址。

macOS / Linux 生产启动：

```bash
npm run build
# 先在环境中配置 NOVA_SESSION_SECRET 等部署变量
npm start
```

Windows PowerShell 生产启动：

```powershell
npm run build
# 先在环境中配置 NOVA_SESSION_SECRET 等部署变量
$env:NODE_ENV = 'production'
node --import tsx server/index.ts
```

注意：

- 默认模拟时钟与电脑当前日期可能不同；请以页面与服务端的模拟日期理解案例。
- 缺失、陈旧或不充分的数据会限制预测，不应将模拟结果理解为真实金融建议。
- 模型无 Key、超时或输出无效时回退到确定性规则；通用自然语言理解能力可能与在线模型模式不同。
- 离线模式只提供最近摘要，不能确认授权、同步数据或执行资金操作。
- 字体和部分图片来自外部资源；核心底部导航与阶段图标使用本地 SVG。
- 当前 Express / SQLite 演示架构不代表已经验证多实例生产部署。

## 项目文档

| 文档 | 内容 |
| --- | --- |
| [产品基线](PRODUCT.md) | 用户价值、页面优先级与产品边界 |
| [用户流程](USER_FLOW.md) | 用户任务、页面流程与边缘情况 |
| [技术说明](docs/TECHNICAL.md) | 架构、契约、状态与 API |
| [Agent 规范](AGENT_SPEC.md) | 意图、规划、工具与护栏 |
| [安全自评](docs/SECURITY_SELF_ASSESSMENT.md) | 安全机制与已知限制 |
| [通用能力说明](docs/COMMON_CAPABILITIES.md) | 依赖、许可证与复用边界 |
| [协作约定](AGENTS.md) | 代码整合、密钥与分支规则 |

## 协作与来源

通过独立分支提交修改，以 PR 评审并合入 main。产品行为以 `PRODUCT.md` 为基线；涉及核心页面的大幅视觉调整应逐屏审查。请勿提交密钥、依赖目录、构建产物或真实金融资料。

NOVA 保留原版界面与交互。经双方授权，后端能力和测试思想选择性参考 `Amy-Lin365/NOVA-AI-Banking-Agent@ca1124c` 的契约、状态机与安全规则，并基于本仓库 Express、TypeScript、SQLite 架构实现；未复制其前端，未合并旧集成 PR #1。
