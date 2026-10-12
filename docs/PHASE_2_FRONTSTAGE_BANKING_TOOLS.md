# 阶段 2：新版前台接入 Banking Tools

## 接入策略

当前无法获得真实银行 Tool 凭证，因此采用 `Banking Sandbox + Provider Adapter`：前台只依赖稳定的 Banking Tool Contract，不直接依赖任何银行 SDK。沙箱真实执行权限、风险、审批、幂等、Operation、Receipt、Audit 和用户隔离；资金和账户数据明确标记为比赛模拟数据。

未来接入微众银行或开放银行时，保留以下层不变：

- 新版 React 前台与交互状态。
- Banking Tool Zod Contracts。
- Permission、Risk、Approval Snapshot、幂等和 Audit。
- Agent Tool Calling 协议与 MCP 协议。

只替换 Tool Provider：把沙箱的数据读取和最终执行委托给银行 API，并将银行回执归一化为现有 Receipt。

## 已完成

- 恢复 Life 页面并加入底部导航。
- 交通请求在 Mandate 单笔边界内由服务端自动执行。
- 购物请求没有 Approval Token 时被服务端阻断，用户可以确认或拒绝。
- 餐饮 ¥680 同时经过授权与 Financial Twin 安全余额判断并被阻断。
- 转账执行 `Snapshot → Draft → Risk → Approval → Permission → Execute → Receipt`。
- 工具超时只返回 `unknown`，保存原 Operation ID，并通过 `get_operation_status` 查询。
- Mandate 支持创建、列表、期限、剩余额度、暂停、撤销和版本递增。
- 所有成功写操作更新 Financial Twin 与 Activity；所有安全决策由服务端执行。

## 自动化验收

运行：

```bash
npm run build
npm run eval:baseline
```

阶段 2 专项脚本为 `npm run verify:stage2`，已并入完整基线评测。专项覆盖 16 项检查：交通自动执行、购物确认门、餐饮阻断、转账草案/Permission/Risk/Approval/Receipt、状态未知查询，以及 Mandate 创建/列表/暂停/撤销/版本。

## 非真实银行声明

当前实现不会调用真实账户、不会产生真实扣款，也不应在演示中表述为已接入微众银行。它是按真实生产边界设计的受治理银行能力沙箱，是接入真实银行前可验证的契约实现。
