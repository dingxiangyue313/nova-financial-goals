import {HandoffCasePackSchema,type DemoState} from '../shared/contracts.ts';
import {stableHash} from './governance.ts';
import {subscriptionDisputes} from './subscription-catalog.ts';

export type ServiceIssue={id:string;domain:'investment'|'card'|'order'|'transfer'|'subscription'|'split';title:string;summary:string;sourceId:string;recovery:'query_service'|'query_subscription'|'review';steps:string[]};
/** Stable source IDs deduplicate material issues across refresh and restart. Read-only. */
export function serviceIssues(state:DemoState):ServiceIssue[]{
 const d=state.financialServices,issues:ServiceIssue[]=[];
 const add=(domain:ServiceIssue['domain'],sourceId:string,title:string,summary:string,recovery:ServiceIssue['recovery'],steps:string[])=>issues.push({id:`${domain}:${sourceId}`,domain,sourceId,title,summary,recovery,steps});
 for(const operation of d.cardOperations.filter(o=>o.status==='unknown'))add('card',operation.id,'卡片操作结果待核对','当前卡片或补发卡暂不可提交新变更或付款；查询原操作，不重复申请。','query_service',['核对原卡片及操作记录。','先查询原操作，不重复补卡或改卡。','结果确认后单独核对解锁和支付开关。']);
 for(const application of d.applications.filter(a=>a.status==='unknown'))add('card',application.id,'卡片申请结果待核对','尚未确认商户是否受理；额度不是现金，不重复申请。','query_service',['查询原申请。','已受理则继续审核；未受理才重新准备。','核对新卡账户及初始限制。']);
 for(const r of d.receipts.filter(r=>['transfer','pay_split_share'].includes(r.kind)&&['unknown','failed'].includes(r.status)))
  add('transfer',r.operationId,r.status==='unknown'?'付款结果待核对':'付款未完成',`金额 ¥${(r.amountCents/100).toFixed(2)}；`+(r.status==='unknown'?'保留当前占用，先查原操作。':'没有成功凭证；重新操作需要新的核对和确认。'),r.status==='unknown'?'query_service':'review',['核对原操作记录与来源账户。','结果未知时不要新建同金额付款。','仅在确认未付款后重新准备。']);
 for(const o of d.investments.filter(o=>['unknown','failed'].includes(o.status)||o.status==='pending'&&o.settlesOn<=state.clock))
  add('investment',o.id,o.status==='unknown'?'理财提交结果待核对':o.status==='failed'?'理财操作未完成':'理财结算待核对',`金额 ¥${(o.amountCents/100).toFixed(2)}；未结算资金或份额不可使用。`,o.status==='failed'?'review':'query_service',['查询原申购或赎回操作。','核对待确认份额、占用与结算日。','未到账不能用于当前付款。']);
 for(const b of d.bookings.filter(b=>['unknown','failed'].includes(b.status)||b.status==='refund_pending'&&b.refundOn!==null&&b.refundOn<=state.clock))
  add('order',b.id,b.status==='unknown'?'旅行订单结果待核对':b.status==='failed'?'旅行订单未完成':'旅行退款待核对',`订单 ¥${(b.amountCents/100).toFixed(2)}；成功项不重跑，退款申请不当作到账。`,b.status==='failed'?'review':'query_service',['核对本订单和独立付款记录。','保留另一笔成功订单。','未知查原操作，退款核对独立到账凭证。']);
 for(const c of d.cards.filter(c=>c.status==='lost'))
  add('card',c.id,'挂失卡片需要更换支付方式',`尾号${c.suffix}已挂失，不能普通解锁；已付订单不会自动撤销。`,'review',['核对挂失凭证。','选择其他有效卡并重新核对支付条件。','补卡需通过模拟服务支持渠道处理。']);
 for(const split of d.splits.filter(s=>['open','partial'].includes(s.status)&&s.dueDate<state.clock)){
  const other=split.payerId&&split.payerId!=='self',remaining=split.shares.filter(s=>other?s.recipientId==='self':s.recipientId!=='self').reduce((n,s)=>n+s.amountCents-s.collectedCents,0);
  if(remaining>0)add('split',split.id,'AA已过截止日期',`${other?'本人未付':'尚未收齐'} ¥${(remaining/100).toFixed(2)}；没有自动扣款或对外催收。`,'review',['核对每人应付和已结算金额。','本人应付款需单独确认；待收不计入余额。','不继续时关闭剩余请求，已收记录保留。']);
 }
 for(const item of state.subscriptions){
  const action=state.subscriptionActions.filter(a=>a.subscriptionId===item.id).at(-1);
  if(action?.action==='cancel'&&['unknown','failed','requires_merchant'].includes(action.status))
   add('subscription',action.id,action.status==='unknown'?'订阅取消结果待核对':action.status==='requires_merchant'?'订阅需要商户处理':'订阅取消未完成',`${item.title}；预计扣费仍保留，尚无已验证节省。`,action.status==='unknown'?'query_subscription':'review',['核对已付服务期和原取消记录。','未知结果先查询原商户操作。','需人工时携带本问题包到模拟服务支持渠道。']);
 }
 for(const dispute of subscriptionDisputes(state))add('subscription',dispute.id,'停扣后出现新扣费',`${dispute.title} · ${dispute.date} · ¥${(dispute.amountCents/100).toFixed(2)}，需要调查，不是退款。`,'review',['核对原交易证据 '+dispute.evidenceId+'。','对照原取消记录 '+dispute.actionId+'。','由商户确认原因，不自动增加余额。']);
 return issues;
}

export function serviceCasePack(state:DemoState,id:string){
 const issue=serviceIssues(state).find(i=>i.id===id);if(!issue)throw new Error('SERVICE_ISSUE_NOT_FOUND');
 const receipts=state.financialServices.receipts.filter(r=>r.operationId===issue.sourceId||state.financialServices.bookings.some(b=>b.id===issue.sourceId&&b.operationId===r.operationId));
 const action=state.subscriptionActions.find(a=>a.id===issue.sourceId);
 const attemptedActions:Array<{actionId:string;label:string;outcome:string}>=receipts.map(r=>({actionId:r.operationId,label:r.kind,outcome:r.status}));
 if(action)attemptedActions.push({actionId:action.id,label:'订阅取消',outcome:action.status});
 return HandoffCasePackSchema.parse({id:`service-case-${stableHash({id,twinVersion:state.twinVersion}).slice(0,24)}`,goalId:state.primaryGoalId,
   summary:issue.title+'：'+issue.summary,facts:[{label:`模拟数据截至 ${state.clock}，版本 ${state.twinVersion}`,sourceRefs:[issue.sourceId]},
     {label:issue.summary,sourceRefs:[issue.sourceId,...(action?.evidenceRefs??[])]},
     ...receipts.map(r=>({label:`操作 ${r.operationId}：${r.date}，金额 ¥${(r.amountCents/100).toFixed(2)}，状态 ${r.status}`,sourceRefs:[r.operationId]}))],
   unknowns:['该事项仍需要核对，不能仅凭问题包推断成功或到账。'],limitations:['仅含本会话模拟数据；未联系外部机构。','不含密钥、支付凭据、完整联系方式或批准令牌。'],
   attemptedActions,receiptOperationIds:receipts.map(r=>r.operationId),questions:issue.steps,createdAt:state.clock+'T12:00:00.000Z'});
}
