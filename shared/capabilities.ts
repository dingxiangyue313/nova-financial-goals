// Business actions are stable; navigation is an implementation detail.
export const capabilities = {
 send_contact_money:{legacy:'transfer',label:'联系人转账',purpose:'给指定联系人付款，准备收款人、金额和来源账户',distinction:'不是多人分摊，也不是向目标储蓄转入',collect:['recipient','amount','account'],page:{category:'transfers',section:'contact'}},
 split_expense:{legacy:'aa_create',label:'发起AA',purpose:'将共同消费按参与人分摊，发起收款或付款',distinction:'不是直接向某个人转账',collect:['participants','amount','payer'],page:{category:'transfers',section:'aa'}},
 review_split_payments:{legacy:'aa_records',label:'AA记录',purpose:'查看均摊应收应付、谁已付和未付',distinction:'查看已有记录，不是新建分摊',collect:[],page:{category:'transfers',section:'records'}},
 browse_investments:{legacy:'investment_products',label:'理财产品',purpose:'浏览可选产品并核对申购',distinction:'不是查看或赎回已持有资产',collect:['product','amount'],page:{category:'wealth',section:'products'}},
 manage_holdings:{legacy:'investment_holdings',label:'持仓管理',purpose:'查看持仓、赎回与结算进度',distinction:'操作已有持仓',collect:['holding'],page:{category:'wealth',section:'holdings'}},
 assess_investment_risk:{legacy:'investment_profile',label:'风险测评',purpose:'投资风险偏好问卷',distinction:'不是查看持仓风险金额',collect:['riskAnswers'],page:{category:'wealth',section:'profile'}},
 manage_cards:{legacy:'cards',label:'卡片管理',purpose:'查看已有卡，挂失、锁卡、解锁、调额',distinction:'不申请新卡，不自动取消订阅',collect:['card'],page:{category:'cards',section:'mine'}},
 apply_card:{legacy:'card_apply',label:'申请新卡',purpose:'选择并申请新银行卡',distinction:'不处理已有卡的锁定或挂失',collect:['product'],page:{category:'cards',section:'apply'}},
 change_subscription_card:{legacy:'subscription_card',label:'订阅付款卡',purpose:'为订阅服务更换扣款银行卡',distinction:'不是取消订阅或换旅行支付卡',collect:['subscription','card'],page:{category:'cards',section:'subscriptions'}},
 read_bills:{legacy:'bills',label:'账单概览',purpose:'查看月账单及年度账单汇总',distinction:'不是导入文件',collect:['period'],page:{category:'bills',section:'overview'}},
 analyze_spending:{legacy:'spending',label:'支出分析',purpose:'查看消费分类、支出变化及核对来源',distinction:'不是试算未来余额',collect:['period'],page:{category:'bills',section:'analysis'}},
 manage_subscriptions:{legacy:'subscriptions',label:'订阅管理',purpose:'查看订阅、取消续费、保留或设置提醒',distinction:'不是更换付款银行卡',collect:['subscription'],page:{category:'bills',section:'subscriptions'}},
 import_statement:{legacy:'bill_import',label:'导入账单',purpose:'上传或导入银行流水文件',distinction:'不是查看已生成账单',collect:['file'],page:{category:'bills',section:'data'}},
 request_travel_quotes:{legacy:'travel_quotes',label:'旅行报价',purpose:'获取或核对机票酒店报价请求',distinction:'不是实际付款和查看已订订单',collect:['goal','quote'],page:{category:'travel',section:'quotes'}},
 manage_travel_authorization:{legacy:'travel_mandate',label:'旅行预算授权',purpose:'设置、修改或撤销未来旅行消费授权范围、上限及有效期',distinction:'只管理允许范围；核对某笔已选机票酒店付款应选择review_travel_payment',collect:['limit','account','expiry'],page:{category:'travel',section:'mandates'}},
 review_travel_payment:{legacy:'travel_payment',label:'核对旅行付款',purpose:'核对已选报价、付款卡、账户和授权，准备本次机票酒店付款',distinction:'付款即使缺少授权也先进入核对付款，页面提示补充；不是修改授权范围',collect:['quotes','card','authorization'],page:{category:'travel',section:'payment'}},
 manage_travel_orders:{legacy:'travel_orders',label:'旅行订单',purpose:'查看已订订单、查询原订单、退款及失败恢复',distinction:'不是新的报价或新付款',collect:['order'],page:{category:'travel',section:'orders'}},
 allocate_goal_cash:{legacy:'goal_allocation',label:'目标资金分配',purpose:'查看或分配现有目标现金、预留、订单、当前可支付金额',distinction:'现有资金归属；不是周期转账也不是未来投入方案',collect:['goal','amount'],page:{category:'overview',section:'allocation'}},
 schedule_goal_deposit:{legacy:'goal_transfer',label:'目标转入安排',purpose:'安排工资到账后、每月固定日或指定日期向目标转入资金',distinction:'用户要设置资金移动的触发和时间，不是创建生活目标或计算每月应存多少',collect:['goal','trigger','amount','account'],page:{category:'overview',section:'transfer'}},
 forecast_cashflow:{legacy:'cashflow',label:'收支试算',purpose:'试算工资、账单、额外支出对未来账户余额的影响',distinction:'不写入实际交易，不是月度历史支出分析',collect:['date','expense'],page:{category:'overview',section:'forecast'}},
 adjust_goal_plan:{legacy:'goal_adjust',label:'调整投入方案',purpose:'打开已有目标未来每月投入分配及期限的调整方案',distinction:'不是设置转入触发；用户正在提供目标具体新金额和日期时由goal处理字段补丁',collect:['goal','constraints'],page:{category:'overview',section:'plans'}},
} as const;
export type BusinessAction=keyof typeof capabilities;
export const businessActions=Object.keys(capabilities) as [BusinessAction,...BusinessAction[]];
export type LegacyDestination=typeof capabilities[BusinessAction]['legacy'];
export const destinationForAction=(action:BusinessAction)=>capabilities[action].legacy;
export const actionForDestination=(destination:LegacyDestination)=>businessActions.find(a=>capabilities[a].legacy===destination)!;
export const pageDestinations=Object.fromEntries(businessActions.map(a=>[capabilities[a].legacy,capabilities[a].page])) as {[K in LegacyDestination]:typeof capabilities[BusinessAction]['page']};
export const semanticCapabilityCatalog=businessActions.map(action=>{
 const {label,purpose,distinction,collect}=capabilities[action];return {action,label,purpose,distinction,collectOnPage:collect,opensOnly:true};
});
