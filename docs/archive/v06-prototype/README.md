# 旧产品增量的保留说明

这些文件来自集成前的本地开发，原始工作完整保存在提交 `3dee4e2`。本次合并以用户更新的 `origin/codex/nova-v06-money-mission-backup@e285c73` 为治理和数据契约基线。

旧增量与新核心同时定义了账单、订阅、预测和定时转账，字段与授权语义不兼容。为避免两套资金状态并行执行，这里保留旧实现作为文本档案；运行实现统一使用 `shared/contracts.ts` 及当前 `server/statement-import.ts`、`subscription-service.ts`、`cashflow-forecast.ts`、`transfer-schedules.ts`、`transfer-worker.ts` 和 `store.ts`。

归档的旧测试依赖已替换的契约，不作为当前回归执行。当前对应领域的测试来自更新核心，并补充了消费者适配、六场景服务、历史数据、HTTP 确认、旧会话迁移及实际浏览器测试；没有用旧测试的通过数充当新版本结果。

旧数据库由 `server/legacy-product-migration.ts` 进行保守迁移：银行余额、目标、原始资料和审计保留；不兼容的旧执行授权及执行记录进入服务端档案，新授权需用户重新确认。该档案不会发布到公开 Snapshot。
