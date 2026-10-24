# NOVA 开发技能推荐

> 查询日期：2026-10-20。已核对官方可安装技能清单、原始技能说明，以及插件目录。
> 本次只做查询和推荐，没有安装这些推荐技能，没有修改全局设置。

## 1. 先分清两类技能

本文推荐的技能用于帮助编码助手规划、开发、调试和验证 NOVA。安装它们不会自动让 NOVA 应用内的 DeepSeek 获得自主能力。

应用内 Agent 的调查、试算和监测仍需按 [分阶段提示词](../NOVA-Agent分阶段开发提示词.md) 实现为工具、任务状态和运行循环。未来可以把这些能力按领域组织为内部技能，但第一版不需要先建立通用技能平台。

## 2. 最适合当前项目的组合

### A. Superpowers：规划、测试、调试与交付

[项目来源](https://github.com/obra/superpowers)。插件目录查询到 Superpowers 可安装，本次查询时尚未安装。已提供安装入口，安装需要用户完成操作；推荐不代表已启用。

建议按任务选择其中的技能：

| 技能 | 帮助 NOVA 做什么 | 使用阶段 |
| --- | --- | --- |
| [writing-plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md) | 将一个阶段细化到文件、接口、测试和执行步骤 | 阶段 0、每阶段开工前按需 |
| [test-driven-development](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md) | 先用失败测试定义行为，再实现任务、约束、并发与幂等 | 阶段 1—6 |
| [systematic-debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md) | 先复现和定位原因，处理循环失控、版本冲突、恢复和测试失败 | 出现故障时 |
| [verification-before-completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md) | 用实际命令结果支持完成声明 | 各阶段交付与阶段 7 |

这些是开发流程技能，不能替代财务计算或 Agent 编排。Superpowers 还包含设计确认和协作流程，完整启用可能引入额外检查点。已有明确范围时应说明本次执行哪个阶段，并遵守用户指令与仓库约定；不要把所有流程无差别叠加。

本次仅阅读相关来源以评估适用性，没有执行这些技能的开发工作流，也没有启动子 Agent。

### B. 官方 Playwright 技能：浏览器交互检查

[技能来源](https://github.com/openai/skills/blob/main/skills/.curated/playwright/SKILL.md)。官方清单查询到 `playwright` 可安装，本机用户技能目录的查询结果显示未安装。

适合在阶段 4 和 7 实际检查对话、卡片、确认、刷新和错误恢复，也能留下截图或 trace。

需要注意它主要是浏览器 CLI 操作工作流；仓库的自动化回归仍应维护现有 `@playwright/test` 用例。该技能默认包装脚本是 shell 脚本，Windows 上使用前应核对实际执行方式，不能直接把 Bash 命令粘贴到 PowerShell。

当前环境已有 computer-use 技能和浏览器控制工具，可在适用时完成交互检查。优先复用已用得上的能力，Playwright 技能不是开发前置条件。

### C. security-best-practices：明确范围的安全检查

[技能来源](https://github.com/openai/skills/blob/main/skills/.curated/security-best-practices/SKILL.md)。官方清单查询到可安装，本机用户技能目录查询显示未安装。

适合在明确要求安全检查时审阅 TypeScript/Express/React 的输入、会话、权限和客户端边界。对 NOVA 可重点检查模型工具白名单、跨会话引用、确认参数和 PWA 敏感缓存。

它不能证明系统安全，也不代替授权、风险、幂等和状态隔离的行为测试。建议用于阶段 3、5 完成后的专门检查。

## 3. 按需补充，暂不必全装

| 技能 | 适用情形 | 来源 |
| --- | --- | --- |
| security-threat-model | 明确要梳理模型、工具、用户确认、MCP 和数据库之间的信任边界与滥用路径时 | [官方说明](https://github.com/openai/skills/blob/main/skills/.curated/security-threat-model/SKILL.md) |
| gh-fix-ci | GitHub Actions 中出现失败，需要读诊断并定位修复时 | [官方说明](https://github.com/openai/skills/blob/main/skills/.curated/gh-fix-ci/SKILL.md) |
| skill-creator | 后续希望将 NOVA 的固定开发规范包装成可重复使用的专属技能时 | 当前环境已有系统技能；本次未创建专属技能 |

`security-threat-model` 需要显式的威胁建模请求，不应在普通功能开发中自动扩展成安全项目。
`gh-fix-ci` 聚焦失败 CI，不等于通用代码审查；涉及 GitHub CLI 时需核实登录、网络和当前环境允许方式。

## 4. 怎样配合本文提示词

技能安装并出现在可用清单后，可使用下面这种指令：

```text
请执行 NOVA-Agent分阶段开发提示词.md 的阶段 1，并遵守公共提示词。
使用已安装的 test-driven-development 完成任务状态行为测试，
交付前用 verification-before-completion 核实实际结果。
如果这些技能本轮不可用，按阶段要求继续，不要虚构调用过技能。
```

不需要为普通文件编辑重新跑产品讨论。需要视觉大改时，遵守仓库要求提交逐屏审查。技能默认规则与明确用户指令发生冲突时，以用户指令为准。

## 5. 推荐优先级

先选择 Superpowers 的测试、调试和验收能力；需要阶段任务细化时使用 writing-plans。
浏览器验证先用现有能力，不足时考虑官方 Playwright 技能。
资金与工具边界实现后，再做一次明确范围的安全检查。

本次官方安装清单脚本的 installed 标记只检查其用户技能目录；插件或系统提供的同类能力应以当前会话技能清单为准，不能据此说系统完全没有该能力。
