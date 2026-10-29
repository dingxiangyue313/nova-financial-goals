# 方案 B：75 项基础验收逐项映射

更新：2026-10-29。对照五份方案原有编号；“已有证据”只表示列出的自动化范围，不等于整份方案或比赛交付完成。更广边界保留为“部分/待完成”，不把测试数量充作验收项数量。最新运行日志见 DEVELOPMENT_CHECKPOINT.md。

| ID | 状态 | 实现/证据与剩余边界 |
| --- | --- | --- |
| T-A01 | 已有证据 | financial-services.test.ts / financial-services-http.test.ts：联系人与转账凭证 |
| T-A02 | 已有证据（合成资料） | recipient-identity.test.ts及三尺寸：同名/尾号/备注、独立待核对、准确尾号确认、版本失效、转账/AA共同检查；不代表银行实名核验 |
| T-A03 | 部分 | 指定日期一次性安排/09:00执行、月末/工资规则、缺薪不补扣有证据；dated-once三尺寸通过；固定日月度消费者编辑仍待补 |
| T-A04 | 已有证据 | split-planner.test.ts：余分、自定义总额、已垫付不再扣 |
| T-A05 | 已有证据（模拟R1） | 12组AA独立目录；provider-events/split-planner领域和三尺寸：部分/重复到账、逾期不入账、关闭保留已收，延期与冻结身份记录；目录见AA_SCENARIO_CATALOG.md |
| T-A06 | 已有证据 | HTTP 确认版本、manifestHash、收款人版本与资金再校验 |
| T-A07 | 已有证据 | financial-services.test.ts / split-planner.test.ts：超时前后及原操作恢复 |
| T-A08 | 已有证据 | transfer-worker.test.ts：缺薪、迟薪、暂停/恢复/取消、租约 |
| B-A01 | 已有证据 | statement-parser.test.ts / http.test.ts：四模板、上传开关、余额不覆盖 |
| B-A02 | 已有证据 | statement-import.test.ts / bill-analysis.test.ts：去重/退款/互转/纠错 |
| B-A03 | 已有证据 | bill-analysis.test.ts：月/年/YTD/部分覆盖，ProductMissionPanel 可切换 |
| B-A04 | 已有证据（模拟R1） | bill-analysis/bill-review/three-acceptance：规则和动态完整基线窗口、逐笔来源、跨期/缺数据/分类纠正；页面调查指引，不宣称欺诈或通用异常模型 |
| B-A05 | 已有证据（支出变化） | 分类更正与旧报告失效；bill-review.test.ts/三尺寸：反馈按精确证据保存，变化后失效、事实保留、余额不改；其他异常类别仍待扩大评测 |
| B-A06 | 已有证据 | statement-import.test.ts：批次撤销、其他批次与现金不变 |
| B-A07 | 已有证据 | http.test.ts / statement-parser.test.ts：会话与不可信文字 |
| B-A08 | 已有证据 | 产品 prepare/confirm 分离，取消选择无金融写操作 |
| S-A01 | 已有证据 | subscription-catalog.test.ts / subscription-catalog.spec.ts：12 画像，年/月/单次 |
| S-A02 | 已有证据 | subscription-service.test.ts：本地决定无商户调用；否认阻断取消 |
| S-A03 | 已有证据 | subscription-notifications.test.ts / subscription-reminder-worker.test.ts：后台本地队列、日期、静默/暂停、稍后/已读、重启去重；不发送外部通知 |
| S-A04 | 已有证据 | 准确确认包含周期、原金额、生效/服务期、不退款；新字段不改旧审批哈希 |
| S-A05 | 已有证据 | cashflow-forecast.test.ts / subscription-catalog.test.ts：仅验证成功才抑制 |
| S-A06 | 已有证据 | 拒绝/需商户/提交前失败/未知分别展示；人工问题包，未计节省 |
| S-A07 | 已有证据 | subscription-service.test.ts：原商户操作查询、重复取消阻断 |
| S-A08 | 已有证据 | subscription-catalog.test.ts：停扣后扣费争议关联交易；不虚构退款 |
| W-A01 | 已有证据 | investment-matching.test.ts / investment-profile.spec.ts：完整问卷、缺资料只读、零损失/备用/随时可用回现金路径 |
| W-A02 | 已有证据 | financial-services.test.ts：期限、风险、锁定期匹配 |
| W-A03 | 已有证据 | 最多三匹配产品排序与现金、整数分费用/锁定/结算/基准及固定压力和乐观情景；明确不是概率或收益承诺 |
| W-A04 | 已有证据 | 整数微份额、费用、待确认、幂等测试 |
| W-A05 | 已有证据 | 赎回份额占用、持有期与重复限制测试 |
| W-A06 | 已有证据（模拟日历） | settlement-acceptance：15:00截止、周末/固定模拟休市顺延、T+1、唯一结算与未到份额不可用；不代表真实市场日历 |
| W-A07 | 已有证据（模拟R1） | settlement-acceptance：净值/费用/持有期变化令manifest失效，停购/风险过期阻断；原审批版本及到期重核 |
| W-A08 | 已有证据（模拟回报协议） | provider-events：申购/赎回未知、拒绝、重复、revision乱序、终态保护；pending不提前结算，原事件唯一资金/份额；实际HTTP重启去重 |
| C-A01 | 已有证据（模拟R1） | 申请/待审/缺合成资料/重审/通过或拒绝；新卡初始锁定，独立确认解锁激活；三尺寸6/6及领域边界 |
| C-A02 | 已有证据（模拟R1） | three-acceptance.test.ts：调额批准/部分批准/零批准拒绝，拒绝保留原额度；现金/目标不变，原card-recovery三尺寸回归 |
| C-A03 | 已有证据 | 付款时检查线上/境外/限额/借记资金 |
| C-A04 | 已有证据 | 显式确认、卡版本与 manifest 变化失效 |
| C-A05 | 已有证据 | card-recovery.test.ts：挂失不可解锁，旧卡保留；补发同账户新卡、锁定及关闭支付开关，重复补发拒绝 |
| C-A06 | 部分 | 挂失问题包及卡内关联订单/付款/退款影响、原单核对；补卡解锁后关闭旧挂失待办。订阅缺绑定明确未知，自动换卡未实现 |
| C-A07 | 已有证据 | 额度与目标现金分离，保护其他目标 |
| C-A08 | 已有证据（模拟） | card-recovery.test.ts：申请/改卡/补发提交前后未知、拒绝、原操作核对与防重复；未知卡阻止变更/付款 |
| X-A01 | 已有证据（签名模拟Inbox） | travel-inbox领域/HTTP/三尺寸：Agent白名单、HMAC、session:goal主体、时间/nonce、CNY/报价完整性；伪造/重放/错主体拒绝，接受请求不授付款权 |
| X-A02 | 已有证据 | 基价/税费/总价/退改/有效期均由服务端报价 |
| X-A03 | 已有证据 | 可编辑/撤销独立 Mandate，目标不自动成为付款权 |
| X-A04 | 已有证据 | financial-services.test.ts / properties.test.ts：预留、分配、保护现金 |
| X-A05 | 已有证据（模拟R1） | 商户预算协商生成签名新请求和替代关系；降价不可退提示，新条件重接受，旧付款确认失效；过期/范围/资金仍重核；已付或未知订单不改价覆盖 |
| X-A06 | 已有证据 | 独立双订单、成功项保留、未知查询原操作 |
| X-A07 | 已有证据 | 按条款取消，退款在途与独立到账事件 |
| X-A08 | 部分 | SQLite恢复、schema v1只读任务图与脱敏证明包、刷新和会话测试；长期任务版本迁移与 webhook 待做 |
| G-A01 | 部分 | 现金/预留/有效订单区分；真实履约证明尚未建模 |
| G-A02 | 已有证据 | 付款后现金＋有效订单覆盖不重复计数、不误退步 |
| G-A03 | 已有证据 | 退款在途不进可花现金，订单取消后展示缺口 |
| G-A04 | 已有证据 | 分配守恒、钱包原属目标、其他目标资金保护 |
| G-A05 | 已有证据 | goal-portfolio.test.ts：版本化约束修改不移动资金、不扩旧授权，关联已授权计划暂停且不能恢复旧授权；HTTP/页面验收结果见接手文档 |
| G-A06 | 已有证据（有界） | goal-portfolio.test.ts：共同日期现金流、优先调整低优先级、二分到整数分边界、最多三种候选；加存/延期空间不会因采用方案自动重置。不声称全局最优 |
| G-A07 | 已有证据 | 无/旧/不一致余额拒绝执行，预测区间不变权威现金 |
| G-A08 | 已有证据 | funded/bookingReady 区分，不声称旅行实际履约 |
| I-A01 | 部分 | 已有版本化目标约束与付款偏好、独立审批及旧授权不扩张；目标通知偏好整合与实际履约证明仍待做 |
| I-A02 | 已有证据 | CashflowTimeline、T+1/应收/预留不可支付的领域测试 |
| I-A03 | 已有证据 | financial-services.spec.ts：8000→现金3000＋有效订单5000 |
| I-A04 | 部分 | 成功单不重跑；已加日期账本下的优先级有界修复、改动金额/日期可复算；不声称所有变更维度的全局最优 |
| I-A05 | 部分 | Evidence/Approval/Receipt 可追溯；所有新场景统一来源呈现仍需逐屏审查 |
| I-A06 | 已有证据（确定性R1） | intent-comparison.test.ts及三尺寸：原选择与商户/金额/税费/退改/有效期/账户/卡差异；降价不可退提示，最终独立确认和冻结再核验；不含开放语义比较 |
| I-A07 | 部分 | schema v1旅行步骤图、独立订单状态和任务证明包导出；审计为相关摘录不冒充完整链，实际履约证据和长期迁移未做 |
| Q-A01 | 已有证据 | HTTP/工作台/导入跨会话隔离与问题包本会话查询 |
| Q-A02 | 已有证据 | 显式确认、批准快照与参数/时效绑定 |
| Q-A03 | 已有证据 | 结构化 Schema 与输入注入防护，流水文字不执行 |
| Q-A04 | 已有证据 | 操作幂等、周期键、结算事件与未知查询测试 |
| Q-A05 | 已有证据（已支持模拟域） | 签名会话绑定、事件id冲突拒绝、revision游标、合法终态不回退；投资/订单分别测试，SQLite原子持久及服务重启/会话隔离；不声称真实Webhook迁移 |
| Q-A06 | 已有证据 | 旧 Twin/报价/风险/授权时效拒绝 |
| Q-A07 | 已有证据 | validateServiceBalances、properties：现金/分配/预留守恒 |
| Q-A08 | 已有证据 | BigInt 微份额、占用、结算与重复赎回测试 |
| Q-A09 | 已有证据 | PWA 离线摘要只读与权限测试；本轮需完整回归复验 |
| Q-A10 | 已有证据（本提交发布日志） | release-log-http/privacy及全量：生产stdout/stderr合成敏感标记扫描，模板路径/自生requestId/元数据白名单、固定解析错误、受控模型诊断；导出白名单既有验证；审查见RELEASE_LOG_AUDIT.md |
| Q-A11 | 部分 | 原有 axe/键盘/确认焦点测试；新增所有状态仍需完整无障碍回归 |
| Q-A12 | 已有证据 | 360/768/1440 浏览器工程已有；本轮日志见接手记录 |

仍需外部条件的工作：真实模型六场景评测、五位真人无引导研究、仓库拥有者逐屏审查、干净部署复现、PR 评审与比赛提交。自动化执行不能替代这些结果。
