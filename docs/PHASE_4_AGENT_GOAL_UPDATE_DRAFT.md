# Agent 架构阶段四：目标修改草案

## 完成结果

阶段四把 `update_goal` 的理解、可行性复核和变更草案生成交给 Candidate Goal Agent，但不把确认或执行交给 LLM。

```text
普通目标修改请求
  → DeepSeek Router 提取目标变化
  → 读取 Financial Twin
  → Feasibility Engine 重新评估
  → prepare_goal_adjustment 生成变更前后方案
  → update_goal 草案（requiresApproval=true）
  → 停止，不执行
```

用户表达“确认修改、确认调整、立即激活”，或请求转账、支付、扣款、划款、授权时，不进入 Candidate Phase 4 Gate，而是回到 Baseline/确定性 Workflow。

## 生产分流

| 请求 | 架构 | 是否执行写操作 |
| --- | --- | --- |
| 财务解释 | Candidate Coach | 否 |
| 目标可行性 | Candidate Goal | 否 |
| 创建目标 | Candidate Goal 草案 | 否 |
| 修改目标 | Candidate Goal 修改草案 | 否 |
| 确认修改、激活计划 | Baseline / Workflow | 仅在独立审批链路后 |
| 转账、支付、Mandate | Banking Sandbox | 仅通过服务端治理后 |
| Prompt Injection | Safe Reject | 否 |

## 修改目标安全链路

真正执行 `update_goal` 时必须：

1. 服务端创建包含 `goalId + changes` 的 Approval Snapshot；
2. 用户在界面中明确确认同一份 Snapshot Hash；
3. 服务端签发一次性 Approval Token；
4. 最终 `goalId` 或 `changes` 任一字段变化，Token 立即无效；
5. Token 只能消费一次；
6. Idempotency Key 与输入哈希绑定；
7. 重试相同输入返回原 Operation，不重复修改；
8. 不同输入复用同一幂等键会被拒绝；
9. 成功和失败均写入用户隔离的 Audit。

自动化安全测试覆盖了修改金额篡改、一次性 Token、重复执行和 `goal_updated` 审计事件。

## 验证结果

真实 DeepSeek Phase 4 生产路由回归：

| 指标 | Candidate |
| --- | ---: |
| 样本 | 20 |
| Intent | 100% |
| Entity | 100% |
| Tool Selection | 100% |
| Structured Output | 100% |
| Prompt Injection | 100% |
| Unsafe Tool Attempt | 0% |
| Evidence Coverage | 100% |
| Feasibility | 100% |
| P95 | 1,012ms |
| Average Tokens / Flow | 238.65 |

同时通过 Phase 4 Rollout Gate、Shadow、Goal Flow 14/14、Banking Security 和 Financial Twin。

阶段三的100条未见表达、三轮360个 Candidate 样本仍作为语言理解准入证据，其中包含20条目标修改表达，全部通过。

## 回滚

```text
NOVA_AGENT_ROLLOUT=phase4  # 默认：创建与修改均生成 Candidate 草案
NOVA_AGENT_ROLLOUT=phase3  # 回滚：Candidate 只生成创建草案
NOVA_AGENT_ROLLOUT=phase2  # 回滚：Candidate 只处理解释和可行性
NOVA_AGENT_ROLLOUT=shadow  # 全部用户响应由 Baseline 返回
```

## 仍不移交

- 用户确认动作；
- 目标激活；
- Approval Token 签发和消费；
- Mandate 创建或扩大；
- 任何资金移动。

这些能力继续由确定性 Workflow、Permission、Risk、Approval、Idempotency 和 Audit 控制。
