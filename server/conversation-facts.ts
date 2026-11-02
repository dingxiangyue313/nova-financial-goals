import type {DemoState} from '../shared/contracts.ts';
import type {SemanticCommand,ReplyEvidence} from '../shared/conversation.ts';
import {assessGoal} from './domain.ts';
import {formatMoney} from './conversation-replies.ts';
export type FactReply={body:string;proof:ReplyEvidence};
export function readConversationFacts(state:DemoState,query:NonNullable<SemanticCommand['read']>):FactReply{
 const proof:ReplyEvidence=[];
 const result=(body:string)=>({body,proof});
 if(query.kind==='account_balances'){
  const accounts=state.accounts.filter(a=>!query.id||a.id===query.id);
  if(!accounts.length)return result('没有找到这个账户，请选择要查询的账户。');
  const lines=accounts.map(a=>{
   const s=state.accountSnapshots.filter(x=>x.accountId===a.id&&x.asOf<=state.clock).sort((a,b)=>b.asOf.localeCompare(a.asOf)||b.twinVersion-a.twinVersion)[0];
   if(!s||s.asOf!==state.clock||s.balanceCents!==a.balanceCents||s.currency!==a.currency||s.twinVersion>state.twinVersion)return `${a.label}：缺少当前有效余额，请先连接或更新账户数据`;
   proof.push({kind:'account_snapshot',id:s.id,version:state.twinVersion,asOf:s.asOf});
   return `${a.label}：余额${s.currency==='CNY'?formatMoney(s.balanceCents):`${s.balanceCents/100} ${s.currency}`}`;
  });return result(lines.join('；')+'。');
 }
 if(query.kind==='travel_orders'){
  const orders=state.financialServices.bookings.filter(b=>!query.id||b.id===query.id||b.goalId===query.id);
  if(!orders.length)return result('当前记录中没有找到对应旅行订单。');
  const statuses={submitted:'已提交',confirmed:'已确认',failed:'未完成',unknown:'结果待核对',cancelled:'已取消',refund_pending:'退款在途',refunded:'已退款'};
  for(const o of orders)proof.push({kind:'order_ledger',id:o.id,version:state.twinVersion,asOf:state.clock});
  return result(orders.map(o=>`${o.merchantId==='air-demo'?'机票':'住宿'}订单：${statuses[o.status]}，${formatMoney(o.amountCents)}${o.status==='unknown'?'，请先查询原订单':o.status==='refund_pending'?'，到账前不计入可用现金':''}`).join('；')+'。');
 }
 const goals=state.goals.filter(g=>!query.id||g.id===query.id);
 if(!goals.length)return result('目前没有对应的已保存目标。聊天草稿中的预算和已存金额还不能代替实际目标账户数据。');
 if(goals.length>1)return result('请选择要查询的目标：'+goals.map(g=>g.title).join('、')+'。');
 const g=goals[0];
 if(query.kind==='goal_funds'){
  if(!state.financialServices.initialized)return result('目标资金账本尚未建立，请先在目标资金页核对分配资金，暂不能确认可支付金额。');
  const ledger=state.financialServices;
  const cash=ledger.allocations.filter(a=>a.goalId===g.id).reduce((n,a)=>n+a.amountCents,0);
  const held=ledger.holds.filter(h=>h.goalId===g.id&&h.status==='active').reduce((n,h)=>n+h.amountCents,0);
  const booked=ledger.bookings.filter(b=>b.goalId===g.id&&b.payment==='captured'&&b.status==='confirmed').reduce((n,b)=>n+b.amountCents,0);
  proof.push({kind:'goal_ledger',id:g.id,version:state.twinVersion,asOf:state.clock});
  return result(`“${g.title}”的目标账本记录：分配资金${formatMoney(cash)}，订单预留${formatMoney(held)}，已付订单${formatMoney(booked)}，其中尚未预留${formatMoney(cash-held)}。实际可支付金额还需核对来源账户、账单及保护资金。`);
 }
 if(g.status!=='active')return result(`“${g.title}”尚未启用计划，暂不能给出按当前计划计算的完成预测。`);
 if(!state.dataConnections.some(c=>c.status==='connected')||state.finance.historyMonths<2)return result('账户或流水依据还不完整，请先连接并补充数据，再计算目标能否按时完成。');
 const checking=state.accounts.find(a=>a.id==='checking');
 if(!checking||!state.accountSnapshots.some(s=>s.accountId==='checking'&&s.asOf===state.clock&&s.balanceCents===checking.balanceCents&&s.currency===checking.currency&&s.twinVersion<=state.twinVersion))return result('账户余额尚未更新，请先刷新余额，再计算目标完成预测。');
 const calculation=assessGoal({...structuredClone(state),goal:structuredClone(g),primaryGoalId:g.id});
 proof.push({kind:'calculation',id:`goal-assessment:${g.id}`,version:state.twinVersion,asOf:state.clock});
 const status={insufficient_data:'数据不足，暂不能判断',on_track:'按当前假设可以按期推进',at_risk:'按当前假设存在延期风险',infeasible:'当前投入条件不足以按期完成'}[calculation.status];
 return result(`依据当前账户、流水和已启用计划计算，“${g.title}”：${status}，已存进度${calculation.progressPercent}%。${calculation.projectedDate?`试算完成日期${calculation.projectedDate}。`:''}`);
}
