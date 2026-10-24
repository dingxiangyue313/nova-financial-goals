# NOVA 压力情景计算：第一至四步

已完成候选方案的逐月模拟、情景输入校验、批量只读压力测试、服务端最小修复搜索，以及 Agent 调用和结果展示。

## 已支持的计算情景

| `kind` | 参数 | 月度作用 |
| --- | --- | --- |
| `baseline` | 无 | 保持原固定月存条件 |
| `current_month_expense` | `amountCents` | 仅减少首月现金流和活期可用余额 |
| `monthly_income_reduction` | `amountCents`，可选 `startMonthIndex` | 从指定模拟月份起持续减少收入 |
| `monthly_essential_spending_increase` | `amountCents`，可选 `startMonthIndex` | 从指定模拟月份起持续增加必要支出 |
| `missed_contribution_once` | `monthIndex` | 指定模拟月份不向目标投入，其他月份保持原计划 |

`startMonthIndex` 和 `monthIndex` 从 0 开始，0 表示当前模拟月份。金额使用整数分。工具拒绝缺少必要参数、参数混用，以及超出目标期限的月份索引。未支持的逐日延薪、汇率和概率情景仍返回 `unsupported`。

## 计算边界

`server/domain.ts:simulateCandidateMonths` 逐月记录可投入额、当月容量、实际投入及累计目标资金。首月同时受本月已发生支出、活期余额和受保护资金限制；后续月份受月度现金流限制。一次性额外支出也减少首月活期可用余额。新情景不修改 Financial Twin。

`assessCandidateScenario` 使用该逐月序列计算目标日累计投入和缺口。无压力基线保持原有 `fundedByTargetCents`、`shortfallCents`、`bufferCents`、`delayDays` 与预计日期公式；压力情景若导致延期，返回 `at_risk` 和新的预计日期，而不会把“压力造成的延期”误判为用户输入违规。模拟历史不足或原本硬限制违规时仍按原有安全边界处理。

压力试算结果保存为调查证据，不进入可选择的基线候选引用；压力结果不能直接走目标激活确认链路。非基线试算不生成基线 `previewId`。

## 批量压力工具

`stress_test_goal_options` 接收 1–3 个当前任务已核验的基线候选结果 ID，以及 1–2 个支持的压力情景，最多计算 6 个组合。每个组合调用服务端 `candidate_preview` 计算并保存压力证据；汇总结果包含基线与压力评估、`holds` / `fails` / `insufficient_data` 判定及明确的失败原因代码。情景金额与月份标记为 `bounded_hypothesis`，表示调用方提出的有界假设，不冒充预测值。

工具仅接受当前会话、任务、运行和财务版本内仍在 `candidateRefs` 中的基线结果。条件或财务版本变动后旧候选不能再用于压力测试。所有组合先校验月份范围，再计算；批量汇总记录 `twinVersion`、`dataAsOf`、基线结果 ID、压力结果 ID 和来源实体。压力结果及汇总只进入 `evidenceRefs`，不进入可推荐候选。工具不会修改 Financial Twin 或创建执行动作。

## 最小修复搜索

`repair_stressed_goal_option` 接收一条批量压力结果 ID 和其中一条失败的压力结果 ID。服务端再次校验当前任务、基线候选、结果归属和财务版本，然后独立搜索两种单条件修复：固定月存增加多少整数分，或目标日最早延长到哪一天。月存不得超过用户上限、当前基线月度可投入额和压力下的首月投入容量；日期不得超过用户允许的最晚日期。二分搜索返回各自边界内最小的通过值及服务端复算结果。两种条件单位不同，不将它们合并成一个“全局最小”数字。

若允许范围内没有修复，返回 `none_within_constraints` 和搜索边界、未找到的原因。不会降低目标金额、动用保护资金、改写用户约束或修改正式计划。修复结果是只读证据；执行任何新条件仍需后续独立的候选核验与用户确认。

## Agent 调查与解释

DeepSeek 决策器在财务概况和候选搜索之后，选择一至两个与已读模拟现金流相关的压力变化；推荐前必须覆盖所有拟推荐的基线候选。批量工具限制模拟金额在现有余额或收入范围内，并记录 `bounded_hypothesis`，避免把假设说成预测。批量结果出现失败时，运行器自动对失败项调用最小修复搜索，减少遗漏。模型失联时仍按原有规则候选回退，并标明提供者，不冒称已完成压力测试。

现有工作台增加 `stress_analysis` 卡片，逐项说明为何测试、首月现金流和目标日缺口如何变化、是否失效，以及月存或日期的最小调整。卡片显示数据日期与财务版本，明确调整尚未生效。卡片仅从当前任务、版本和被推荐候选关联的已保存结果生成；用户选择的仍是原基线候选。

## 验证与后续

`server/candidate-monthly-simulation.test.ts` 对照旧公式验证无压力结果，并验证一次性与持续冲击、收入变化起始月份、漏存月份、保护资金和状态不变。`server/agent-read-tools.test.ts` 验证新情景的工具输入与证据归属。

`server/agent-stress-batch.test.ts` 验证批量结果来源、只读属性、重复调用去重，以及跨任务、旧条件、旧版本、非法月份和不支持情景的拒绝。
`server/agent-stress-repair.test.ts` 验证月存和日期的最小修复、边界内无修复、跨任务或过期证据拒绝，以及正式 Financial Twin 和 Action 数量不变。
`server/agent-runner.test.ts` 覆盖 Agent 选择压力变化、自动修复失败项、工作台解释卡和原候选推荐隔离。

逐月模拟当前仍沿用原项目的“每 30 天约一个模拟月”和目标日前后日期插值方式；它不是逐日银行现金流预测。真实 DeepSeek 自主选择质量仍需通过独立模型评测验证，脚本化测试只能证明工具链和边界正确。
