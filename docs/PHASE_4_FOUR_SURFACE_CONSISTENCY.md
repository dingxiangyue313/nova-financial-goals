# 阶段 4：四页面统一状态与浏览器回归

## 完成范围

Today（首页）、Life、Financial Twin（NOVA 财务分身）和 Activity 共用 `useFinancialTwin` 客户端数据层。唯一状态源是当前沙箱用户的 `/api/financial-twin`，页面不再各自保存财务副本。顶部同步条显示同一个 Twin Version、活期余额和最新活动。

写入 Banking Tool 后，客户端重新读取服务端 Twin；状态只接受不低于当前版本的响应，旧请求晚返回也不能覆盖新状态。切换四个页面、窗口重新获得焦点和页面刷新时重新同步。情景模拟是只读结果，不会写入正式 Twin。

NOVA 的“审计”页现在展示服务端 `get_activity` 返回的真实事件，移除了旧版占位哈希。完整哈希链仍由安全控制台的证据包导出提供。个人页同步更新了 Mandate 和审计功能入口说明。

## 浏览器验收

`npm run verify:stage4` 使用真实 Chrome 和隔离的本地 D1 沙箱运行六条 E2E：

1. 确认一笔购物后，在 Today、Life、Financial Twin、Activity 检查同一 Twin Version 和活期余额，并检查审计事件。
2. 拒绝购物后检查审计记录存在、活期余额与 Twin Version 不因扣款而改变。
3. 重复点击确认、刷新页面及模拟慢速 Twin 请求，检查状态不会回退。
4. 分别在 360、768、1440 px 检查四页面没有横向溢出。

验证结果：Chrome E2E 6/6 通过；TypeScript 类型检查通过；生产构建通过；完整基线的 Banking Security、Twin、四页面投影、阶段 2、阶段 3 均通过。基线评测在未调用真实 LLM 的 deterministic 模式下执行，不代表真实 Provider 成本或延迟。

## 运行

```bash
npm run build
npx tsc --noEmit -p frontend/tsconfig.json
npm run verify:stage4
```

浏览器测试服务由 Playwright 全局设置创建和销毁，不依赖已经运行的 `localhost:5173` 服务，也不会接触真实银行账户。
