# Agent 架构阶段一迁移：Shadow Mode

## 当前生产路径

用户请求仍由 Baseline 0 综合 Agent 返回结果：

```text
POST /api/agent
  → 身份与限流
  → Baseline 0
  → 返回用户
```

同一次请求会以只读方式运行 Candidate 1：

```text
  → Candidate Router
      ├─ Goal Agent
      ├─ Coach Agent
      └─ Safe Reject
  → 比较 Intent / Entity / Tool Plan / Security / Evidence / Feasibility / Token / Latency
  → 保存 agent_shadow 记录与 agent_shadow_compared 审计事件
```

Candidate 的写工具只会形成 `requires_approval` 计划，不会执行；Shadow Mode 中它只有读取 Twin 和运行确定性可行性计算的能力。Candidate 失败不会改变 Baseline 响应。

## 查询结果

```http
GET /api/agent?limit=20
x-nova-sandbox-session: <session>
```

返回生产架构、Candidate 执行模式、差异汇总和逐次比较记录。记录按用户隔离，最多读取 100 条。

## 已退出的旧链路

以下旧 Demo 文件已删除：

- `agent-orchestrator.ts`
- `mock-banking-tools.ts`
- `governance.ts`
- `external-agent-runtime.ts`

前端入口现在只渲染 `NovaFusionApp`。Agent、Twin 和 Banking Tools 统一走服务端 API，不再编译隐藏的 `LegacyHomePage` 和 Mock Orchestrator。

## 阶段二准入条件

- Shadow 样本达到约定数量。
- Candidate 的安全硬门槛全部为零事故。
- 未见测试集仍优于或不劣于 Baseline。
- 真实模型 token 成本和 P95 延迟在预算内。
- Candidate 失败不影响 Baseline 可用性。
