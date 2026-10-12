# Phase 17 — Financial Twin 闭环

## 统一状态

`GET/POST /api/financial-twin` 是 Today、Life、Twin、Activity 与 Banking Tools 共用的状态源。每个用户在 D1 中拥有独立 `financial_twin` 记录，包含账户、现金流事件、目标、Mandate、活动和单调递增版本号。更新使用 `updated_at` 乐观并发控制，冲突最多安全重试两次。

## 现金流模型

预测引擎不使用固定结果，而是从活期余额出发，在 30 天区间逐日应用账单、必要支出、订阅、收入、用户操作和情景事件，计算每天 opening/net/closing balance、最低余额和期末余额。

最低余额减去用户安全线得到目标资金容量。容量按照目标 priority 分配，输出每个目标的 requested、allocated、shortfall 和 funded/competing/deferred 状态；剩余部分才是 safeToSpend。

`simulate_expense` 使用同一模型叠加 hypothetical event，但不写正式状态。正式消费会更新活期、现金流、Mandate 剩余额度、活动和 Twin 版本，并立即重算预测。

## 页面闭环

- Today：读取 Twin 版本、目标进度、活期、安全余额、safeToSpend、期末余额；金额输入调用服务端情景模拟。
- Life：读取目标和受保护资金；方案选择、目标激活、Mandate 更新、购物确认/拒绝写入 Twin。
- Twin：读取统一账户、现金流时间线、Mandate 和目标竞争结果，决策模拟以当前服务端余额为基准。
- Activity：优先显示 Twin 服务端活动；页面切换会刷新状态，因此 Banking Tools 写入也会出现。

## 验证

```bash
npm run verify:twin
```

测试在全新隔离用户中执行 ¥280 购物操作，确认同一个 Twin 版本同时产生：活期减少、Mandate 余量减少、预测最低余额变化、活动追加，且 Banking Tools 快照读取到完全相同的数据。
