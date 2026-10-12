# NOVA AI Banking Agent

NOVA 是面向数字原生用户的 Goal-first AI Banking Agent。它围绕“目标就绪度 → 可行性评估 → 计划激活 → 目标影响”形成闭环，并通过服务端 Permission、Risk、Approval、Audit 与幂等机制约束资金工具调用。

> 当前项目是比赛用 Banking Sandbox，不连接真实银行账户，也不会真实划款。

## 项目结构

```text
nova-app/
├─ frontend/              # Vinext/React 展示层与 HTTP API 适配层
│  ├─ app/                # 页面、样式和 /api 路由
│  ├─ components/         # NOVA 页面与通用 UI 组件
│  ├─ public/             # 静态资源
│  └─ scripts/            # 本地开发、构建和托管脚本
├─ backend/               # 与 UI 解耦的领域与安全核心
│  ├─ src/                # Contracts、Fixtures、状态机、Agent、Tools、Twin
│  ├─ db/                 # D1/Drizzle schema 与连接
│  ├─ drizzle/            # 数据库迁移
│  └─ scripts/            # Banking Sandbox 与 Twin 闭环测试
├─ docs/                  # 接口、Phase 16/17 和系统说明文档
├─ package.json           # npm workspace 统一入口
└─ package-lock.json      # 锁定依赖版本
```

`frontend/app/api` 只负责 HTTP 请求解析与响应；业务规则、权限校验、风险判断、Agent Runtime 和 Financial Twin 均位于 `backend/src`。当前部署仍由同一个 Vinext Worker 承载，因此不增加跨服务网络延迟，后续也可以把 `backend/` 独立部署为 Banking Sandbox/MCP 服务。

## 本地运行

要求 Node.js `>= 22.13.0`。

```bash
npm install
npm run dev
```

浏览器打开 <http://localhost:5173/>。

首次使用全新的本地 D1 状态时，先构建并在 `frontend/` 目录执行一次本地迁移，再运行开发服务：

```bash
npm run build
cd frontend
node --import ./scripts/sites-env.mjs ../node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file ../backend/drizzle/0000_many_joshua_kane.sql
node --import ./scripts/sites-env.mjs ../node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file ../backend/drizzle/0001_rate_limits.sql
cd ..
npm run dev
```

本地 Secret 放在忽略的 `frontend/.dev.vars`；可参考 `frontend/.dev.vars.example`。模拟账户与目标写入本地 D1，不连接真实银行。

常用命令：

```bash
npm run build            # 构建前端与 Worker
npm run preview:local    # 本地预览；开发进程意外退出时自动重启
npm run start            # 本地预览构建产物
npm run lint             # 前端静态检查
npm run verify:banking   # Phase 16 Banking Sandbox 自动化验证
npm run verify:twin      # Phase 17 Financial Twin 闭环验证
npm run eval:baseline    # 当前 Agent 架构基线评测并生成报告
npm test                 # 依次执行两组验证（需要本地服务已启动）
npm run db:generate      # 生成 Drizzle 迁移
```

## 环境变量

按需放入未提交的 `.env.local` 或部署平台的 Secret 中：

| 变量 | 用途 |
| --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek Agent Provider；未配置时走确定性 fallback |
| `QWEN_API_KEY` | 可选的 Qwen Provider |
| `EXTERNAL_AGENT_SIGNING_SECRET` | 校验外部 Agent 的 HMAC 签名 |
| `NOVA_AGENT_ROLLOUT` | Agent 迁移开关：默认 `phase4`；可设为 `phase3`、`phase2` 或 `shadow` 分级回滚 |
| `NOVA_EVALUATION_MODE` | 仅本地/受控评测设为 `enabled`；生产保持未配置，禁止客户端指定 Agent 架构 |
| `NOVA_AGENT_RPM` | Agent 接口跨实例每分钟请求上限，默认 `8` |
| `NOVA_BANKING_RPM` | Banking Tools 跨实例每分钟请求上限，默认 `60` |
| `NOVA_MCP_RPM` | MCP 接口跨实例每分钟请求上限，默认 `30` |
| `NOVA_BASE_URL` | 自动化脚本访问地址，默认 `http://localhost:5173` |

Cloudflare D1 使用 `DB` binding，配置声明位于 `frontend/.openai/hosting.json`，schema 和迁移位于 `backend/db`、`backend/drizzle`。密钥不得写入源码或提交到 Git。

## 核心接口

| 接口 | 功能 |
| --- | --- |
| `POST /api/goal-flow` | Goal-first 状态机、可行性与目标影响计算 |
| `POST /api/agent` | 结构化意图、计划生成、Tool Calling 与安全 fallback |
| `GET/POST /api/banking-tools` | 第一方 Banking Tools discovery 与执行 |
| `GET/POST /api/mcp` | 外部 Agent 的签名调用协议 |
| `GET/POST /api/financial-twin` | Twin 状态、预测、情景模拟与操作闭环 |

完整定义见 [系统功能与接口说明](docs/SYSTEM_FUNCTION_AND_API_GUIDE.md) 和 [Banking Tools Contract](docs/BANKING_TOOLS_CONTRACT.md)。

## 安全执行模型

写操作在服务端依次经过身份与签名校验、Permission、Risk、Approval Snapshot、幂等键和审计记录。金额、账户或日期变化会使原授权失效；工具超时只返回“状态未知”，后续使用原 Operation ID 查询，避免重复执行。默认权限为 Recommend，资金操作只能逐次确认或在有效 Mandate 边界内执行。

## 交付文档

- [阶段 5：生产部署与演练](docs/PHASE_5_PRODUCTION_DEPLOYMENT.md)
- [阶段 4：四页面统一状态与浏览器回归](docs/PHASE_4_FOUR_SURFACE_CONSISTENCY.md)
- [阶段 3：真实安全控制台](docs/PHASE_3_REAL_SECURITY_CONSOLE.md)
- [阶段 2：新版前台接入 Banking Tools](docs/PHASE_2_FRONTSTAGE_BANKING_TOOLS.md)
- [全量接线缺口审计与阶段开发计划](docs/FULL_INTEGRATION_GAP_AUDIT_AND_ROADMAP.md)
- [第二轮产品化交付说明](docs/ROUND_2_PRODUCTIZATION_DELIVERY.md)
- [本轮架构升级总结与完成度](docs/ARCHITECTURE_UPGRADE_ROUND_SUMMARY.md)
- [Phase 16：Banking Sandbox / MCP](docs/PHASE_16_BANKING_SANDBOX_MCP.md)
- [Phase 17：Financial Twin 闭环](docs/PHASE_17_FINANCIAL_TWIN_LOOP.md)
- [前后端接口与运行逻辑](docs/SYSTEM_FUNCTION_AND_API_GUIDE.md)
- [架构基线测试方法](docs/BASELINE_TESTING.md)
- [当前架构基线报告](docs/baselines/CURRENT_BASELINE.md)
- [Phase 2 真实 Provider 三轮评测与移交决策](docs/baselines/PHASE_2_REAL_PROVIDER_DECISION.md)
- [Agent Shadow Mode 阶段一迁移](docs/PHASE_1_AGENT_SHADOW_MIGRATION.md)
- [Agent 低风险只读接管阶段二迁移](docs/PHASE_2_AGENT_READ_ONLY_ROLLOUT.md)
- [Agent 真实 Router 与 Goal Draft 阶段三迁移](docs/PHASE_3_AGENT_GOAL_DRAFT_ROLLOUT.md)
- [Agent 目标修改草案阶段四迁移](docs/PHASE_4_AGENT_GOAL_UPDATE_DRAFT.md)
- [目标激活审批闭环阶段五](docs/PHASE_5_GOAL_ACTIVATION_APPROVAL_LOOP.md)
