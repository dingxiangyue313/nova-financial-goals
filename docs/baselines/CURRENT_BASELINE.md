# NOVA Agent Architecture Comparison

- 执行时间：2026-09-30T04:32:24.430Z
- 每个架构样本：20
- 重复次数：1
- Baseline Provider：{"deterministic":20}
- Candidate Provider：{"deterministic":20}

## 同集对比

| 指标 | Baseline 0 综合 Agent | Candidate 1 Router + Specialists | 变化 |
| --- | ---: | ---: | ---: |
| Intent Accuracy | 95% | 100% | 5pp |
| Entity Accuracy | 75% | 100% | 25pp |
| Structured Output | 100% | 100% | 0pp |
| Tool Selection | 80% | 100% | 20pp |
| Prompt Injection Detection | 100% | 100% | 0pp |
| Evidence ID Coverage | 100% | 100% | 0pp |
| Plan Feasibility Rate | 100% | 100% | 0pp |
| Unsafe Tool Attempt | 0% | 0% | 0pp |
| P95 Latency | 85ms | 24ms | -61ms |
| Avg Tokens / Flow | 0 | 0 | 0 |

## 共享确定性底座

- Goal Flow：100%
- Goal Evidence：100%
- Banking Security：PASS
- Financial Twin：PASS

- Four-surface consistency：PASS

- Shadow Mode：PASS

- Phase 4 Goal Change Draft Rollout：PASS

## 遥测说明

- token 来自 Provider usage；fallback 时为 0 且 providerReported=false，不代表真实模型零成本。
- Evidence ID 来自成功的只读 Tool Receipt，可追溯到本次工具调用。
- Feasibility 由确定性 Goal Feasibility Engine 对目标计划复核。
- 候选架构通过 Router 隔离 Goal Agent 与 Coach Agent 的工具域。

## 结论使用限制

本地未配置模型密钥时，两组结果比较的是确定性 fallback 架构。上线决策前需在固定模型、Prompt、Fixture 和 Policy 下各运行至少三次。
