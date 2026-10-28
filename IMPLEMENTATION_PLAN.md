# NOVA v0.6 Implementation Plan

> 2026-10-28：已集成更新核心 `e285c73` 并扩展六场景模拟消费者流程、13 项 Skill、大量历史数据与保守迁移。当前实现及明确保留的后续范围见 [六场景实现与交接](docs/SIX_SCENARIO_IMPLEMENTATION.md)。旧状态记录的通过数不可当作本轮验收结果。

> 下一版方向已选方案 B：六场景目标完成型 Money Mission。详细产品、逐屏流程、技术、数据验收与交付计划见 [完整设计](docs/plans/2026-10-27-plan-b-complete/README.md)。以下保留 v0.6 原实施计划，不能将旧范围当作六场景新版已完成。

> 状态：设计已批准，15 项任务已进入实现与发布验证。最新逐项进展、边界与实际验收记录见 [实施状态](docs/V06_RELEASE_STATUS.md)。
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
