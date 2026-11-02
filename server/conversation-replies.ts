import type {ConversationTask,ConversationState,SemanticCommand} from '../shared/conversation.ts';
import type {DemoState,AgentComponent} from '../shared/contracts.ts';
import {capabilities,actionForDestination} from '../shared/capabilities.ts';

export const formatMoney=(cents:number)=>`¥${(cents/100).toLocaleString('zh-CN',{maximumFractionDigits:2})}`;
const date=(value:unknown)=>String(value).replace(/^(\d{4})$/,'$1年').replace(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/,(_,y,m,d)=>`${y}年${Number(m)}月${d?`${Number(d)}日`:''}`);
const name=(t:ConversationTask)=>String(t.goal.title??t.name??'这个目标');

export function taskChangeReply(before:ConversationState,task:ConversationTask){
 const previous=before.tasks.find(t=>t.id===task.id);
 const start=!previous?`已新建“${name(task)}”。`:before.activeTaskId!==task.id?`已切回“${name(task)}”。`:'';
 const budget=task.goal.targetCents,when=task.goal.targetDate,saved=task.goal.savedCents;
 const changed=previous&&Object.keys(task.goal).some(k=>task.goal[k as keyof typeof task.goal]!==previous.goal[k as keyof typeof previous.goal]);
 const items=[typeof budget==='number'?`${previous&&previous.goal.targetCents!==budget?'预算已改为':'预算'}${formatMoney(budget)}`:null,
 when?`${previous&&previous.goal.targetDate===when&&changed?'日期保持':'目标日期'}${date(when)}`:null,
 typeof saved==='number'?`已存${formatMoney(saved)}`:null].filter(Boolean);
 const fields={title:'目标名称',targetCents:'预算',savedCents:'已存金额',targetDate:'日期',monthlyContributionCapCents:'每月投入上限',protectedCents:'保护资金'};
 const cleared=previous?Object.entries(fields).filter(([key])=>previous.goal[key as keyof typeof fields]!=null&&task.goal[key as keyof typeof fields]==null).map(([,label])=>label):[];
 return start+(cleared.length?'已清除'+cleared.join('、')+'。':'')+(items.length?items.join('，')+'。':'');
}

export function renderGoalReply(before:ConversationState,task:ConversationTask,state:DemoState,components:AgentComponent[]){
 const prefix=taskChangeReply(before,task);
 let question:string;
 if(!task.goal.title)question='这个目标是为了什么？';
 else if(task.goal.targetCents==null)question='这个目标一共需要多少钱？';
 else if(!task.goal.targetDate)question=task.timeHint?`已记下${date(task.timeHint)}，希望在具体哪一天准备好资金？`:'希望在什么时候准备好资金？';
 else if(task.goal.savedCents==null)question='目前为这个目标已经存了多少？还没开始存可以回复0元。';
 else if(!state.dataConnections.some(c=>c.status==='connected'))question='目标条件已齐全，请先连接数据，再根据账户和流水核算方案。';
 else if(state.finance.historyMonths<2)question='目标条件已齐全，还需要至少两个月的流水才能核算方案。';
 else question='目标条件已齐全，可以开始核算方案；计算结果出来后再选择并确认。';
 const body=prefix+question;
 // Replace only the collection question; preserve tool/confirmation components.
 if(components[0]?.type==='clarification')components[0]={...components[0],body,suggestions:[]};
 return body;
}

export function renderServiceReply(task:ConversationTask){
 if(!task.capability)return '请先选择要办理的事项。';
 const label=capabilities[actionForDestination(task.capability)].label;
 if(task.capability==='transfer'){
  const details=[task.recipientQuery?`收款人搜索词“${task.recipientQuery}”`:null,task.amountCents!=null?`金额${formatMoney(task.amountCents)}`:null,task.sourceAccount?`来源账户“${task.sourceAccount}”`:null].filter(Boolean);
  return `已准备联系人转账${details.length?'：'+details.join('，'):''}。请在页面核对身份和付款信息，再确认操作。`;
 }
 return `前往“${label}”，请在页面继续查看或核对信息。`;
}
export function renderClarification(command:SemanticCommand,task:ConversationTask|undefined){
 if(command.actionCandidates.length>1)return '你想先办理哪一项：'+command.actionCandidates.map(a=>capabilities[a].label).join('、')+'？';
 const prefix=task?.kind==='goal'?`关于“${name(task)}”，`:'';
 switch(command.questionKey){
  case 'amount_role':return prefix+'这笔金额是目标总预算、已经存下的钱，还是每月打算存的金额？';
  case 'target_date':return prefix+'希望在什么时候准备好资金？';
  case 'target_budget':return prefix+'一共需要准备多少钱？';
  case 'savings':return prefix+'目前已经存了多少？';
  default:return '你想先办理什么事项？可以描述目标、说明要查看的信息，或选择下方功能。';
 }
}
