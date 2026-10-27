# NOVA v0.6 Implementation Plan

> 状态：设计已于 2026-10-26 获产品 Owner 批准；等待选择执行方式。
> 基线：`432d85eeb38e0c7d301429a1f72e79f0df7a2290`

详细、可逐项执行的 TDD 计划位于：

- [NOVA v0.6 Money Mission Implementation Plan](docs/superpowers/plans/2026-10-26-nova-v0.6-money-mission.md)

计划包含 15 个按依赖排序、各自可测试和评审的任务，覆盖：

1. 契约、冻结 Fixture 与兼容迁移。
2. 合成/受控账单导入与对账。
3. 证据化账单分析和订阅识别。
4. 可验证订阅取消。
5. 日期级现金流与三个目标方案。
6. 工资事件触发的定时转账和恢复。
7. 10 个 Skill 的静态 Registry，其中 Skills 6–7 保持 P1 disabled。
8. 高保真 Money Mission UI、监测、人工交接和发布评测。

实施时必须逐任务使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，不得跳过任务内的失败测试、通过测试和提交检查点。
