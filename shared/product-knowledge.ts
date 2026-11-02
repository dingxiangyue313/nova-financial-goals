// Reviewed product explanations, not account facts or user-specific advice.
export const productKnowledge={
 account_data_source:{label:'账户数据与连接要求',text:'账户金额需要来自有效的余额快照。缺少当前有效余额时，不能凭聊天内容或历史金额推断现在余额；请先连接或更新账户数据，再查询。聊天里的预算和已存金额也不能代替实际账户余额。'},
 transfer_vs_split:{label:'转账与AA的区别',text:'联系人转账是向指定收款人付款；AA是把共同消费按参与人分摊，并记录每个人的应收应付。打开功能后仍需核对信息并确认。'},
 authorization_vs_payment:{label:'授权与付款的区别',text:'授权规定未来付款允许的用途、商户、限额和有效期；设置授权本身不代表已付款。核对付款针对本次已选订单，确认后才会提交对应操作。'},
 refund_pending:{label:'退款在途',text:'退款在途表示资金尚未退回到账。这部分不能作为当前可用现金；请在原订单里查询到账进度。'},
 goal_allocation:{label:'目标资金分配',text:'目标资金分配记录现有资金属于哪个目标。已分配现金、订单预留和已付订单分别展示；分配资金不等于发起银行转账。'},
 held_funds:{label:'订单预留',text:'订单预留是为未确认结果的付款保留的资金，尚不等于订单付款成功。应先查询原操作，不能把预留再次用于付款。'},
 fund_redemption:{label:'基金赎回',text:'赎回是将已持有份额申请换回现金。可赎份额、费用及到账安排由对应产品和结算结果决定；提交申请不等于资金已经到账。'},
 emergency_fund:{label:'应急金',text:'应急金是为突发支出预留的资金。在目标规划中，它属于需要保留的约束；不能把保留金额当作可自由投入目标的钱。'},
 card_types:{label:'信用卡与借记卡',text:'借记卡使用账户已有资金；信用卡使用授信额度并需要还款。信用额度不作为目标现金，也不作为本应用旅行付款的可用资金。'},
 subscription_price:{label:'订阅价格变化',text:'扣费增加可能涉及服务商调价、套餐或优惠变化。具体原因需要查看商户通知和实际扣费来源，不能仅凭金额变化确定。'},
 cashflow_forecast:{label:'收支试算',text:'收支试算根据已知余额、收入和账单假设计算未来余额。它不会新增实际交易；结果取决于数据和假设是否完整。'},
} as const;
export const knowledgeIds=Object.keys(productKnowledge) as [keyof typeof productKnowledge,...Array<keyof typeof productKnowledge>];
