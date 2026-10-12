# Agent 架构阶段二迁移：低风险只读接管

## 迁移结果

阶段二启用按意图分流，不再让所有功能连接同一个综合 Agent：

```text
POST /api/agent
  → 身份、限流、Prompt Injection 检测
  → Baseline 与 Candidate 并行运行并记录差异
  → Phase 2 Gate
      ├─ 财务解释                    → Candidate Coach Agent
      ├─ 纯目标可行性分析            → Candidate Goal Agent
      ├─ 创建/调整/激活目标           → Baseline 0
      ├─ 转账/支付/授权等写操作       → Baseline 0
      ├─ 安全信号或 Candidate 失败    → Baseline 0
      └─ 未识别意图                   → Baseline 0
```

Candidate 在阶段二只拥有读取 Financial Twin 和调用确定性 Feasibility Engine 的能力。任何写工具都不能在本阶段由 Candidate 成功执行。

## 准入规则

| 判定原因 | 条件 | 返回架构 |
| --- | --- | --- |
| `READ_ONLY_COACH` | Router 判定为财务解释 | Candidate / Coach Agent |
| `READ_ONLY_FEASIBILITY` | Router 判定为 Goal，且用户只要求分析可行性 | Candidate / Goal Agent |
| `BASELINE_ONLY_INTENT` | 创建、修改、激活、支付、转账、授权或其他意图 | Baseline 0 |
| `SECURITY_SIGNAL` | 检测到 Prompt Injection 或绕过授权意图 | Baseline 0 |
| Candidate 执行失败 | Candidate 超时或异常 | Baseline 0 |

前端提交的 `architecture` 字段不能决定生产路由。只有服务端设置 `NOVA_EVALUATION_MODE=enabled`，且请求同时携带内部评测头 `x-nova-evaluation-mode: true` 时，自动化评测才能显式选择架构。生产环境不配置该开关，用户无法靠伪造请求头绕过服务端 Gate。

## 回滚

部署环境变量：

```text
NOVA_AGENT_ROLLOUT=phase2   # 回滚到低风险 Candidate 接管
NOVA_AGENT_ROLLOUT=shadow   # 一键退回阶段一，所有响应由 Baseline 返回
```

回滚不会关闭 Candidate 的只读对照运行和差异记录，因此仍可继续收集迁移证据。

## 可观测性

`GET /api/agent?limit=20` 返回按用户隔离的对照记录，包括：

- Intent、Entity、Tool Plan 与 Security 是否一致；
- 两套架构的延迟、Evidence ID 数、Feasibility 与 Token；
- `phase2Eligible`、`eligibilityReason` 和推荐架构；
- 汇总中的 `candidateEligible` 数量。

单次 `POST /api/agent` 响应还包含实际生效的 `architecture` 与 `rollout.stage/reason`，可据此确认这一次由谁服务。

## 自动化门禁

`npm run eval:baseline` 使用不带架构参数的真实生产请求验证：

1. Coach 解释由 Candidate 接管；
2. 纯 Feasibility 分析由 Candidate 接管；
3. 创建和调整目标仍留在 Baseline；
4. Prompt Injection 强制留在 Baseline；
5. 两个接管场景均无成功写工具；
6. Shadow、Goal Flow、Banking Security 和 Financial Twin 回归全部通过。

## 阶段三建议门槛

- 使用真实 Provider 重复运行固定测试集至少三次；
- Candidate 的安全硬门槛保持零事故；
- 线上只读接管错误率、P95 和 token 成本达到预算；
- 扩充未见表达、边界金额和对抗输入；
- 达标后再迁移“创建目标计划”，资金执行仍保持确定性 Workflow + 服务端 Policy。
