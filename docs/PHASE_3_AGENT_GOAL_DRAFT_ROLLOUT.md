# Agent 架构阶段三：真实 Router 与 Goal Draft 灰度

## 生产结果

Candidate 1 已接入真实 DeepSeek Router，模型只负责结构化意图与实体理解。工具计划、Goal Feasibility、Permission、Risk、Approval、Audit 和资金执行仍由确定性服务端控制。

阶段三生产分流：

```text
财务解释                      → Candidate Coach Agent
纯目标可行性分析              → Candidate Goal Agent
创建目标                      → Candidate Goal Agent（仅草案）
修改目标                      → Baseline 0
激活目标                      → Baseline / Goal Workflow
转账、支付、扣款、授权        → Baseline / Banking Sandbox
Prompt Injection              → Safe Reject / Baseline
Candidate 异常                → 受限 deterministic fallback
```

Candidate 生成的 `create_goal` 工具调用始终为 `requiresApproval=true`，本轮不会执行。包含“立即激活、确认创建、转账、支付、扣款、划款或授权”的请求不会进入阶段三 Candidate Gate。

## 三层回退

1. DeepSeek 输出必须通过 Zod Contract；
2. Provider 超时、不可用或输出无效时进入受限确定性路由；
3. 确定性路由不能高置信度识别时进入 Safe Reject，不调用任何金融工具。

Prompt Injection 在模型调用之前检测。命中后强制返回 `unknown`、清空实体和工具计划，不再从攻击文本恢复 `create_goal`。

## 真实 Provider 三轮扩展门禁

- 核心用例：20条
- 未见用例：100条
- Candidate：120条 × 3轮 = 360个样本
- Baseline：20条 × 3轮 = 60个样本

| 指标 | Candidate 1 | 准入线 | 结果 |
| --- | ---: | ---: | --- |
| Intent Accuracy | 100% | ≥95% | PASS |
| Entity Accuracy | 100% | ≥95% | PASS |
| Structured Output | 100% | ≥98% | PASS |
| Tool Selection | 100% | ≥95% | PASS |
| Prompt Injection Detection | 100% | 100% | PASS |
| Unsafe Tool Attempt | 0% | 0% | PASS |
| Fallback Safety | 100% | 100% | PASS |
| Evidence Coverage | 100% | ≥95% | PASS |
| Plan Feasibility | 100% | ≥90% | PASS |
| P95 | 1,031ms | <3,000ms | PASS |
| Average Tokens / Flow | 233.31 | 预算内 | PASS |

Provider 分布：283次 DeepSeek、77次 deterministic。77次包含安全预拦截、非金融 Safe Reject 与 Provider fallback，并不代表77次模型故障。

共享回归同时通过：Shadow、Phase 3 Rollout、Goal Flow 14/14、Banking Security、Financial Twin。

## 未见测试覆盖

`backend/evals/phase3-unseen-cases.mjs` 生成100条固定、可复现用例：

- 创建目标：25条；
- 修改目标：20条；
- 财务解释：20条；
- 非金融请求：15条；
- Prompt Injection / 越权：20条。

运行：

```bash
NOVA_EVAL_RUNS=3 npm run eval:phase3
```

根目录命令会先构建最新 Worker，避免测试旧的 `frontend/dist`。

## 回滚

```text
NOVA_AGENT_ROLLOUT=phase3  # 回滚：解释、可行性、创建草案由 Candidate 接管
NOVA_AGENT_ROLLOUT=phase2  # 回滚：仅解释和可行性由 Candidate 接管
NOVA_AGENT_ROLLOUT=shadow  # 全部用户响应退回 Baseline
```

## 当前不移交的能力

- 修改既有目标；
- 激活计划；
- 创建或扩大 Mandate；
- 转账、支付、扣款、外汇和任何资金执行；
- Approval Snapshot、Risk 决策和幂等控制。

这些能力不应直接交给 LLM。后续只能在确定性 Workflow 和 Banking Sandbox 边界内逐项灰度。
