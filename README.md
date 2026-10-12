# NOVA 智能财务目标导航

**不用记账，也知道目标能不能按时实现。** NOVA 从一句话创建目标，展示可行性和三种以内的储蓄节奏；只有显著变化影响目标时才提示调整。首页、创建目标、可行性和目标影响页使用原 NOVA 原型的青绿色视觉，计算、Agent、审批与安全规则由服务端提供。

> 当前项目是比赛演示用模拟金融沙盒，不连接真实银行账户，也不会真实划款。

## 分享与获取代码

仓库地址：[dingxiangyue313/nova-financial-goals](https://github.com/dingxiangyue313/nova-financial-goals)。仓库为私有；队友先由仓库拥有者在 **Settings → Collaborators** 邀请，并接受 GitHub 邀请，之后才能克隆或下载 ZIP。

本次整合基线：界面仓库 `805a0f6`，业务与安全源码来自 `Amy-Lin365/NOVA-AI-Banking-Agent@ca1124c`。页面字段和接口映射见 [集成对照](docs/INTEGRATION_MAPPING.md)，产品定位见 [PRODUCT.md](PRODUCT.md)。后续改动请在本仓库开分支并通过 PR 评审。

## 项目结构

```text
nova-financial-goals/
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

要求 Node.js `>= 22.13.0`、npm 和 Git。

```bash
git clone https://github.com/dingxiangyue313/nova-financial-goals.git
cd nova-financial-goals
npm ci
npm run dev
```

终端出现本地地址后，在浏览器打开 <http://localhost:5173/>。保持终端运行；结束时按 `Ctrl+C`。也可在 GitHub 的 **Code → Download ZIP** 下载并解压，再进入解压目录执行 `npm ci` 和 `npm run dev`。

首次运行 `npm run dev` 会自动构建并初始化本地 D1 模拟数据库，之后再次启动会复用现有数据。若想重置演示数据，请先备份并清理本地忽略的 `frontend/.wrangler/state`。

本地 Secret 放在忽略的 `frontend/.dev.vars`；可参考 `frontend/.dev.vars.example`。如需实时目标解析，在该文件填写自己的 `DEEPSEEK_API_KEY`；Qwen 是可选备援。**不填 Key 也可以使用确定性演示模式。** 不要把真实 Key 提交到 GitHub，也不要发给队友。模拟账户与目标写入本地 D1，不连接真实银行。

常用命令：

```bash
npm run build            # 构建前端与 Worker
npm run preview:local    # 本地预览；开发进程意外退出时自动重启
npm run start            # 本地预览构建产物
npm run lint             # 前端静态检查
npm run verify:banking   # Phase 16 Banking Sandbox 自动化验证
npm run verify:twin      # Financial Twin 闭环验证
npm run verify:goal      # 目标状态、提醒阈值和生成组件验证
npm run eval:baseline    # 当前 Agent 架构基线评测并生成报告
npm test                 # 依次执行 Banking、Twin 和 Goal 验证（需要本地服务已启动）
npm run db:generate      # 生成 Drizzle 迁移
```

## 环境变量

本地开发时按需放入未提交的 `frontend/.dev.vars`，部署时放入平台 Secret：

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
| `GET/POST /api/goal-flow` | 读取当前目标可行性、受治理组件和只读支出情景；保留历史状态机演示契约 |
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
