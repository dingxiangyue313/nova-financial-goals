# NOVA 协作约定

- 本仓库是唯一集成仓库。产品行为以根目录 `PRODUCT.md` 为准；四页数据流见 `docs/INTEGRATION_MAPPING.md`。
- 首页、创建目标、可行性、目标影响页保持目标优先的用户叙事和现有青绿色视觉。面向普通用户的页面避免直接展示 Financial Twin、Schema、Agent Runtime 等内部术语。
- 金额在服务端统一使用整数分，UI 边界才格式化为元。日期在接口中使用 ISO `YYYY-MM-DD`。目标金额、状态、可行性与影响从 Financial Twin 和 Goal Flow 获取，不在 React 组件中写死或重新计算。
- 方案初始未选择；用户选择并明确确认后才激活。任何资金模拟写操作仍须通过服务端 Permission、Risk、Approval Snapshot、幂等与 Audit。默认权限是 Recommend，激活计划不等于授权自动转账。
- DeepSeek 是优先模型，Qwen 可选，确定性模式兜底。模型只解析意图、生成说明或选择白名单 UI 组件，不决定财务结果或权限。真实 Key 仅放服务端 Secret 或本地未追踪的 `frontend/.dev.vars`，绝不提交。
- 修改组件 Schema 时同步修改 `backend/src/generative-ui.ts`、`frontend/components/generative-renderer.tsx` 和实际页面流程；未知组件与无效动作要安全降级。
- 改动通过分支和 PR 协作。提交前至少运行 `npm run build`、`npx tsc --noEmit -p frontend/tsconfig.json` 和受影响的验证脚本。不要把 `node_modules`、构建产物、密钥文件或个人数据加入 Git。
