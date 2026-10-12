# 阶段五：目标激活审批闭环

## 完成结果

阶段五没有扩大 LLM 权限，而是把“确认并激活当前方案”从前端确认标记升级为银行级服务端审批闭环。

```text
Candidate Goal Agent 生成草案
  → 用户选择方案
  → create_approval_snapshot 冻结 goalId / selectedPlan / twinVersion
  → 前端展示确认动作
  → 用户明确点击确认
  → confirm_approval 签发一次性 Approval Token
  → activate_goal 在服务端复核 Twin 版本和全部参数
  → 消费 Token + 幂等执行
  → 更新 Financial Twin
  → 写入 goal_activated Audit 和 Receipt
```

## 安全属性

- Candidate、Prompt 或前端不能自行签发 Approval Token。
- `goalId`、所选方案或 `twinVersion` 变化后，旧授权失效。
- Twin 在确认与执行之间变化时返回 `TWIN_VERSION_CHANGED`。
- Approval Token 只能消费一次。
- 同一 Idempotency Key + 相同参数返回原 Operation。
- 同一 Idempotency Key + 不同参数返回冲突。
- 激活只开启目标监测与提醒，Receipt 固定返回 `autoTransferAuthorized=false`。
- 自动转账、Mandate 和资金执行权限不会随目标激活产生。

## 前端接线

可行性页面的“确认并激活当前方案”按钮现在真实调用：

1. `POST /api/banking-tools` → `create_approval_snapshot`
2. `POST /api/banking-tools` → `confirm_approval`，要求 `x-nova-user-confirmed: true`
3. `POST /api/banking-tools` → `activate_goal`
4. `GET /api/financial-twin` 刷新 Today、Goals、Twin 和 Activity 使用的统一状态

任何一步失败都会停止链路并显示服务端安全错误，不会跳到后续执行。

## 自动化验证

Banking Sandbox 新增以下断言：

- 激活参数与 Approval Snapshot 完全绑定；
- 篡改所选方案被拒绝；
- Token 单次消费；
- 相同请求重试不重复激活；
- Receipt 明确不包含自动转账授权；
- `goal_activated` 审计事件存在；
- 激活后 Financial Twin 统一更新。

同时通过：

- TypeScript / Vinext 生产构建；
- Phase 4 Agent Rollout；
- Goal Flow 14/14；
- Banking Security；
- Financial Twin 闭环；
- Shadow 对照。

## 阶段边界

Agent Rollout 仍保持 `phase4`，因为阶段五迁移的是确定性审批与激活 Workflow，不是新增 Agent 权限。可继续使用：

```text
NOVA_AGENT_ROLLOUT=phase4 → phase3 → phase2 → shadow
```

目标激活永远不等于资金授权。后续若增加自动储蓄，必须单独创建版本化 Mandate，或每笔使用新的 Approval Snapshot。
