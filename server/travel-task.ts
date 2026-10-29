import type {DemoState} from '../shared/contracts.ts';
import {TravelTaskSchema,TravelProofSchema,type TravelTask} from '../shared/travel-task.ts';

/** Derived from current persisted artifacts. A task refresh never submits a financial operation. */
export function travelTask(state:DemoState,goalId:string,now=Date.now()):TravelTask{
 const goal=state.goals.find(g=>g.id===goalId);if(!goal)throw new Error('SERVICE_GOAL_NOT_FOUND');
 const d=state.financialServices,bookings=d.bookings.filter(b=>b.goalId===goalId),mandates=d.mandates.filter(m=>m.goalId===goalId),nodes:TravelTask['nodes']=[];
 const node=(id:string,label:string,dependsOn:string[],status:TravelTask['nodes'][number]['status'],detail:string,sourceRefs:string[])=>nodes.push({id,label,dependsOn,status,detail,sourceRefs});
 const activeBookings=bookings.filter(b=>!['failed','refunded'].includes(b.status));
 const quotes=['air-demo','stay-demo'].map(merchant=>{const booking=activeBookings.find(b=>b.merchantId===merchant);return booking?d.quotes.find(q=>q.id===booking.quoteId):d.quotes.filter(q=>q.merchantId===merchant&&Date.parse(q.expiresAt)>now).at(-1);}).filter(q=>q!==undefined);
 const quotesOk=quotes.length===2;
 node('quotes','含税费报价',[],quotesOk?'complete':'pending',quotesOk?'两商户报价已记录；已确认订单不因报价后来到期而失效。':'需要当前有效的机票与住宿报价；过期后重新询价。',quotes.map(q=>q.id));
 const mandate=mandates.filter(m=>m.status==='active'&&Date.parse(m.expiresAt)>now&&
   quotes.every(q=>m.merchants.includes(q.merchantId)&&q.totalCents<=m.maxPerOrderCents)&&m.totalCents-m.spentCents-m.reservedCents>=quotes.filter(q=>!bookings.some(b=>b.quoteId===q.id&&b.status==='confirmed')).reduce((n,q)=>n+q.totalCents,0)).at(-1);
 const paidComplete=['air-demo','stay-demo'].every(m=>bookings.some(b=>b.merchantId===m&&b.status==='confirmed'&&b.payment==='captured'));
 node('mandate','独立付款授权',['quotes'],mandate||paidComplete?'complete':'pending',paidComplete?'已付订单保留原批准记录；撤销或到期只阻断新订单。':mandate?'当前授权仍有效；每个订单仍需核对。':'没有当前有效授权，需要明确创建或更新。',mandate?[mandate.id]:[...new Set(bookings.map(b=>b.mandateId))]);
 const source=mandate?.accountId??activeBookings.at(-1)?.accountId??'goal-wallet';
 const cards=d.cards.filter(c=>c.accountId===source&&c.type==='debit'&&c.status==='active'&&c.online&&c.overseas&&quotes.every(q=>q.totalCents<=c.limitCents));
 const card=cards.find(c=>!d.cardOperations.some(o=>o.status==='unknown'&&(o.cardId===c.id||o.replacementCardId===c.id)));
 node('card','支付卡片条件',['mandate'],card||paidComplete?'complete':'blocked',paidComplete?'历史付款卡状态不撤销已经确认的订单。':card?'有效借记卡已开启线上和境外交易；付款时仍复核金额限制。':'需核对锁定、挂失、支付开关或未知卡片操作。',card?[card.id]:activeBookings.map(b=>b.cardId));
 const cash=d.allocations.filter(a=>a.goalId===goalId).reduce((n,a)=>n+a.amountCents,0);
 const booked=bookings.filter(b=>b.status==='confirmed'&&b.payment==='captured').reduce((n,b)=>n+b.amountCents,0);
 const held=d.holds.filter(h=>h.goalId===goalId&&h.status==='active').reduce((n,h)=>n+h.amountCents,0);
 const allocated=d.allocations.filter(a=>a.goalId===goalId&&a.amountCents>0);
 const currentBalances=allocated.every(allocation=>{const account=state.accounts.find(a=>a.id===allocation.accountId);return Boolean(account&&state.accountSnapshots.some(s=>s.accountId===account.id&&s.asOf===state.clock&&s.balanceCents===account.balanceCents&&s.currency===account.currency&&s.twinVersion<=state.twinVersion));});
 const unknown=bookings.some(b=>b.status==='unknown'),refund=bookings.some(b=>b.status==='refund_pending');
 node('funds','目标资金与独立预留',['card'],unknown?'unknown':!currentBalances?'blocked':cash+booked>=goal.targetCents?'complete':'pending',`目标现金 ¥${cash/100}，其中预留 ¥${held/100}；有效订单 ¥${booked/100}。${currentBalances?'':'余额快照缺失或已过期，需要重新核对。'}未来收入和退款在途不算可支付现金。`,[goalId,...d.holds.filter(h=>h.goalId===goalId).map(h=>h.id)]);
 for(const [merchant,label] of [['air-demo','机票订单'],['stay-demo','住宿订单']] as const){
  const b=bookings.filter(b=>b.merchantId===merchant).at(-1);
  const status=!b?'pending':b.status==='confirmed'?'complete':b.status==='unknown'?'unknown':b.status==='submitted'?'pending':'needs_recovery';
  node(merchant,label,['funds'],status,!b?'尚未提交，不会自动预订。':b.status==='confirmed'?'商户订单已确认；不代表服务已经实际履约。':b.status==='unknown'?'保留本单预留，先查询原操作；另一笔成功单不重跑。':b.status==='refund_pending'?'退款在途，尚未计入现金。':b.status==='failed'?'本单未完成；可重新询价，仅处理失败项。':'本单已取消或退款，若仍需旅行请重新核对计划。',b?[b.id,b.operationId,b.quoteId,b.mandateId]:[]);
 }
 const recovery=unknown||refund||bookings.some(b=>['failed','cancelled','refunded'].includes(b.status));
 node('verify','结果验证与恢复',['air-demo','stay-demo'],unknown?'unknown':recovery?'needs_recovery':paidComplete?'complete':'pending',paidComplete?'两份独立订单均已确认，可导出证明包；旅行履约仍需后续证据。':'按原订单核对未知、失败或退款。任务不提供自动重付或强制回滚。',bookings.map(b=>b.operationId));
 return TravelTaskSchema.parse({id:`travel-task:${goalId}`,schemaVersion:1,goalId,goalTitle:goal.title,twinVersion:state.twinVersion,asOf:state.clock,
  status:refund?'refund_pending':paidComplete?'booked':recovery?'needs_attention':'planning',coverageCents:cash+booked,targetCents:goal.targetCents,nodes,
  limitations:['任务图是现有工件的只读视图，不产生付款权。','预订确认与真实旅行履约分开；未提供实际履约证明。','任务schema版本1；仅支持本地模拟状态，不承诺外部webhook兼容。']});
}
export function travelProof(state:DemoState,goalId:string,now=Date.now()){
 const task=travelTask(state,goalId,now),operationIds=new Set(state.financialServices.bookings.filter(b=>b.goalId===goalId).map(b=>b.operationId));
 for(const mandate of state.financialServices.mandates.filter(m=>m.goalId===goalId))operationIds.add(mandate.id);
 const operations=state.financialServices.receipts.filter(r=>operationIds.has(r.operationId)).map(r=>({operationId:r.operationId,kind:r.kind,status:r.status,amountCents:r.amountCents,date:r.date}));
 const audit=state.audit.filter(a=>a.operationId&&operationIds.has(a.operationId)&&a.eventHash&&a.previousHash).map(a=>({id:a.id,stage:a.action,status:a.outcome,hash:a.eventHash!,previousHash:a.previousHash!}));
 return TravelProofSchema.parse({schemaVersion:1,task,operations,audit,limitations:['只导出当前会话相关任务的脱敏证据，不含签名、密钥或批准令牌。','这是原审计链的选择性摘录；核验完整链需保留服务端全链，不把摘录宣称为独立完整链。','生成与下载不发送给任何外部机构。']});
}
