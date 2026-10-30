import type {DemoState} from '../shared/contracts.ts';
export function travelRecoveryOptions(s:DemoState,goalId:string){
 if(!s.goals.some(g=>g.id===goalId))throw new Error('SERVICE_GOAL_NOT_FOUND');const orders=s.financialServices.bookings.filter(b=>b.goalId===goalId),failed=orders.filter(b=>b.status==='failed'&&!orders.some(other=>other.merchantId===b.merchantId&&['confirmed','unknown','refund_pending'].includes(other.status))&&orders.filter(other=>other.merchantId===b.merchantId).at(-1)?.id===b.id),unknown=orders.filter(b=>b.status==='unknown'),refund=orders.filter(b=>b.status==='refund_pending');
 const options=[{id:'keep',label:'保持现状，先核对证据',changes:0,amountCents:0,operationIds:[] as string[]}];
 if(unknown.length)options.push({id:'query',label:'只查询未知原订单，不重新付款',changes:1,amountCents:0,operationIds:unknown.map(b=>b.id)});
 else if(failed.length)options.push({id:'retry_failed',label:'仅为失败服务重新询价，成功订单保留',changes:failed.length,amountCents:failed.reduce((n,b)=>n+b.amountCents,0),operationIds:failed.map(b=>b.id)});
 if(refund.length)options.push({id:'refund',label:'先核对退款到账，再决定是否重订',changes:1,amountCents:0,operationIds:refund.map(b=>b.id)});
 return {goalId,options:options.sort((a,b)=>a.changes-b.changes||a.amountCents-b.amountCents).slice(0,3),limitations:['候选空间仅为保持/查原单/失败项询价/退款核对；按改变数量及涉及金额排序，不声称全局最优。','选项不会取消成功订单、重付未知订单或自动提高授权；实际新付款仍须独立确认。']};
}
