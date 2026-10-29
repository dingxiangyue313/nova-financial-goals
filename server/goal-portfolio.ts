import type {DemoState,Goal,GoalContract} from '../shared/contracts.ts';
import {GoalContractTermsSchema} from '../shared/goal-contract.ts';
import {buildDatedCashflowForecast} from './cashflow-forecast.ts';
import {stableHash} from './governance.ts';

const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
const sum=(values:number[])=>{const total=values.reduce((n,v)=>n+v,0);if(!Number.isSafeInteger(total))throw new Error('PORTFOLIO_INVALID_CENTS');return total;};
export function goalContract(state:DemoState,goal:Goal):GoalContract {
 const stored=state.financialServices.goalContracts.find(c=>c.goalId===goal.id);
 return stored?{...stored,title:goal.title,targetCents:goal.targetCents,targetDate:goal.targetDate,monthlyContributionCents:goal.monthlyContributionCents,protectedCents:goal.protectedCents}:{
  goalId:goal.id,title:goal.title,targetCents:goal.targetCents,targetDate:goal.targetDate,monthlyContributionCents:goal.monthlyContributionCents,
  protectedCents:goal.protectedCents,priority:3,maxMonthlyIncreaseCents:0,maxExtensionDays:goal.flexibilityWeeks*7,allowPayments:true,
  revision:0,updatedAt:state.clock+'T12:00:00.000Z',requiredChecks:['funds','card','mandate','orders'],
  protectedAccountIds:state.accounts.filter(a=>a.protected).map(a=>a.id),
 };
}
export function changedGoalContract(state:DemoState,raw:unknown){
 const terms=GoalContractTermsSchema.parse(raw),goal=state.goals.find(g=>g.id===terms.goalId);
 if(!goal)throw new Error('SERVICE_GOAL_NOT_FOUND');
 if(terms.targetDate<=state.clock)throw new Error('GOAL_DATE_MUST_BE_FUTURE');
 const previous=goalContract(state,goal);
 const schedules=state.transferSchedules.filter(s=>s.goalId===goal.id).map(s=>s.id);
 if(state.transferExecutions.some(e=>schedules.includes(e.scheduleId)&&['unknown','executing'].includes(e.status)))throw new Error('GOAL_OPERATION_STATUS_REQUIRED');
 return {...terms,revision:previous.revision+1,updatedAt:state.clock+'T12:00:00.000Z',requiredChecks:previous.requiredChecks,protectedAccountIds:previous.protectedAccountIds};
}
export function applyGoalContract(state:DemoState,contract:GoalContract):DemoState {
 const old=state.goals.find(g=>g.id===contract.goalId);if(!old)throw new Error('SERVICE_GOAL_NOT_FOUND');
 const updated={...old,title:contract.title,targetCents:contract.targetCents,targetDate:contract.targetDate,
  monthlyContributionCents:contract.monthlyContributionCents,protectedCents:contract.protectedCents,selectedPlanId:null,status:'draft' as const};
 return {...state,goals:state.goals.map(g=>g.id===old.id?updated:g),goal:state.goal.id===old.id?updated:state.goal,
  financialServices:{...state.financialServices,goalContracts:[...state.financialServices.goalContracts.filter(c=>c.goalId!==old.id),contract]},
  transferSchedules:state.transferSchedules.map(schedule=>schedule.goalId===old.id&&schedule.status==='active'?{...schedule,status:'paused' as const,nextEvaluationAt:null,updatedAt:state.clock+'T12:00:00.000Z'}:schedule)};
}

export type PortfolioChange={goalId:string;title:string;beforeMonthlyCents:number;monthlyCents:number;beforeDate:string;targetDate:string};
/** A repair consumes the original adjustment window; it never silently opens a fresh window. */
export function portfolioRepairTerms(state:DemoState,change:PortfolioChange){
 const goal=state.goals.find(g=>g.id===change.goalId);if(!goal)throw new Error('SERVICE_GOAL_NOT_FOUND');
 const before=goalContract(state,goal),extension=Math.round((Date.parse(change.targetDate)-Date.parse(before.targetDate))/86400000);
 const ceiling=Math.min(100000000,before.monthlyContributionCents+before.maxMonthlyIncreaseCents);
 if(change.monthlyCents>ceiling||extension<0||extension>before.maxExtensionDays)throw new Error('PORTFOLIO_CONSTRAINT_CHANGED');
 return GoalContractTermsSchema.strip().parse({...before,targetDate:change.targetDate,monthlyContributionCents:change.monthlyCents,
  maxMonthlyIncreaseCents:ceiling-change.monthlyCents,maxExtensionDays:before.maxExtensionDays-extension});
}
export type PortfolioOption={id:string;label:string;changes:PortfolioChange[];minimumBalanceCents:number;minimumBalanceDate:string;changedGoals:number;monthlyChangeCents:number;extensionDays:number};
export function buildGoalPortfolio(state:DemoState){
 if(state.goals.length>20)throw new Error('PORTFOLIO_GOAL_LIMIT');
 const contracts=state.goals.map(g=>goalContract(state,g));
 const account=state.accounts.find(a=>a.id==='checking');
 const maxDate=shift(state.clock,366);
 const end=contracts.reduce((date,c)=>{const proposed=shift(c.targetDate,c.maxExtensionDays);return proposed>date?proposed:date;},shift(state.clock,32));
 const horizonEnd=end>maxDate?maxDate:end;
 // This is a replacement hypothesis for monthly goal plans. One-time commitments remain in the baseline.
 const baseline=buildDatedCashflowForecast({...state,transferSchedules:state.transferSchedules.filter(s=>s.recurrence!=='monthly')},{accountId:'checking',horizonEnd,scenario:'baseline'});
 const salaryIds=new Set(state.transactions.filter(t=>t.accountId==='checking'&&t.sourceKind==='bank'&&t.category==='income'&&t.title==='工资'&&t.amountCents>0).map(t=>t.id));
 const dates=[...new Set(baseline.events.filter(e=>e.kind==='income'&&e.amountCents>0&&(e.label==='工资'||e.sourceRefs.some(ref=>salaryIds.has(ref)))).map(e=>shift(e.date,1)).filter(d=>d>state.clock&&d<=horizonEnd))].sort();
 const held=state.financialServices.holds.filter(h=>h.accountId==='checking'&&h.status==='active');
 const reserve=sum(held.map(h=>h.amountCents))+sum(state.financialServices.allocations.filter(a=>a.accountId==='checking').map(a=>Math.max(0,a.amountCents-sum(held.filter(h=>h.goalId===a.goalId).map(h=>h.amountCents)))))+
  Math.max(0,...contracts.map(c=>c.protectedCents-state.finance.emergencyCents));
 const goals=state.goals.map(g=>{
  const contract=contracts.find(c=>c.goalId===g.id)!;
  const coveredCents=sum(state.financialServices.allocations.filter(a=>a.goalId===g.id).map(a=>a.amountCents))+sum(state.financialServices.bookings.filter(b=>b.goalId===g.id&&b.payment==='captured'&&b.status==='confirmed').map(b=>b.amountCents));
  return {goalId:g.id,title:g.title,contract,coveredCents,remainingCents:Math.max(0,g.targetCents-coveredCents)};
 });
 type Plan={goalId:string;monthlyCents:number;targetDate:string};
 const original:Plan[]=goals.map(g=>({goalId:g.goalId,monthlyCents:g.contract.monthlyContributionCents,targetDate:g.contract.targetDate}));
 function simulate(plans:Plan[]){
  const remaining=new Map(goals.map(g=>[g.goalId,g.remainingCents])),completion=new Map(goals.filter(g=>g.remainingCents===0).map(g=>[g.goalId,state.clock]));
  const events=baseline.events.map(e=>({date:e.date,amountCents:e.amountCents,priority:e.priority,id:e.id}));
  for(const date of dates)for(const plan of plans){const gap=remaining.get(plan.goalId)!;if(!gap||date>plan.targetDate||plan.monthlyCents<=0)continue;
   const amount=Math.min(gap,plan.monthlyCents);remaining.set(plan.goalId,gap-amount);if(gap===amount)completion.set(plan.goalId,date);
   events.push({date,amountCents:-amount,priority:40,id:`portfolio:${plan.goalId}:${date}`});
  }
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.priority-b.priority||a.id.localeCompare(b.id));
  let balance=account?.balanceCents??0,minimumBalanceCents=balance,minimumBalanceDate=state.clock;
  for(const e of events){balance=sum([balance,e.amountCents]);if(balance<minimumBalanceCents){minimumBalanceCents=balance;minimumBalanceDate=e.date;}}
  const unfulfilled=goals.filter(g=>!completion.has(g.goalId)).map(g=>({goalId:g.goalId,title:g.title,remainingCents:remaining.get(g.goalId)!,targetDate:plans.find(p=>p.goalId===g.goalId)!.targetDate}));
  return {minimumBalanceCents,minimumBalanceDate,shortfallCents:Math.max(0,reserve-minimumBalanceCents),unfulfilled,completion};
 }
 const current=simulate(original),options:PortfolioOption[]=[];
 const limited=goals.some(g=>g.remainingCents>0&&g.contract.targetDate>horizonEnd);
 const eligible=baseline.precision==='exact'&&!limited;
 const valid=(plans:Plan[])=>{const result=simulate(plans);return !result.shortfallCents&&!result.unfulfilled.length;};
 const required=(g:typeof goals[number],date:string)=>{const count=dates.filter(d=>d<=date).length;return g.remainingCents===0?0:count?Math.ceil(g.remainingCents/count):Number.MAX_SAFE_INTEGER;};
 const lowerFirst=[...goals].sort((a,b)=>b.contract.priority-a.contract.priority||b.contract.targetDate.localeCompare(a.contract.targetDate)||a.goalId.localeCompare(b.goalId));
 function candidate(label:string,extend:boolean,liquidity:boolean){
  const floors=new Map(goals.map(g=>[g.goalId,required(g,extend?([shift(g.contract.targetDate,g.contract.maxExtensionDays),horizonEnd].sort()[0]):g.contract.targetDate)]));
  if(goals.some(g=>floors.get(g.goalId)!>g.contract.monthlyContributionCents+g.contract.maxMonthlyIncreaseCents))return;
  const plans=goals.map(g=>({goalId:g.goalId,monthlyCents:liquidity?floors.get(g.goalId)!:Math.max(g.contract.monthlyContributionCents,floors.get(g.goalId)!),targetDate:extend?[shift(g.contract.targetDate,g.contract.maxExtensionDays),horizonEnd].sort()[0]:g.contract.targetDate}));
  for(const g of lowerFirst){if(valid(plans))break;const plan=plans.find(p=>p.goalId===g.goalId)!,upper=plan.monthlyCents,low=floors.get(g.goalId)!;
   plan.monthlyCents=low;if(!valid(plans))continue;
   let left=low,right=upper;while(left<right){const mid=Math.ceil((left+right)/2);plan.monthlyCents=mid;if(valid(plans))left=mid;else right=mid-1;}plan.monthlyCents=left;
  }
  if(!valid(plans))return;
  const predicted=simulate(plans);
  for(const plan of plans){const old=original.find(p=>p.goalId===plan.goalId)!;const completion=predicted.completion.get(plan.goalId)!;plan.targetDate=completion>old.targetDate?completion:old.targetDate;}
  const result=simulate(plans);if(result.shortfallCents||result.unfulfilled.length)return;
  const changes=plans.flatMap(plan=>{const old=original.find(p=>p.goalId===plan.goalId)!;return old.monthlyCents===plan.monthlyCents&&old.targetDate===plan.targetDate?[]:[{...plan,title:goals.find(g=>g.goalId===plan.goalId)!.title,beforeMonthlyCents:old.monthlyCents,beforeDate:old.targetDate}];});
  if(!changes.length)return;
  const id=`portfolio-${stableHash({rule:'dated-portfolio-v1',twinVersion:state.twinVersion,forecast:baseline.id,contracts,changes})}`;
  if(options.some(o=>o.id===id))return;
  options.push({id,label,changes,minimumBalanceCents:result.minimumBalanceCents,minimumBalanceDate:result.minimumBalanceDate,changedGoals:changes.length,
   monthlyChangeCents:sum(changes.map(c=>Math.abs(c.monthlyCents-c.beforeMonthlyCents))),extensionDays:sum(changes.map(c=>Math.round((Date.parse(c.targetDate)-Date.parse(c.beforeDate))/86400000)))});
 }
 if(eligible&&(current.shortfallCents||current.unfulfilled.length)){
  candidate('保持目标日期，先调整低优先级目标',false,false);
  candidate('在允许范围内延后，减少改动',true,false);
  candidate('降低月存，保留更多流动资金',true,true);
 }
 return {twinVersion:state.twinVersion,asOf:state.clock,horizonEnd,reservedCents:reserve,contracts,goals:goals.map(g=>({...g,projectedDate:current.completion.get(g.goalId)??null})),
  eligible,status:!eligible?'insufficient_data' as const:current.shortfallCents||current.unfulfilled.length?'needs_adjustment' as const:'on_track' as const,
  current:{minimumBalanceCents:current.minimumBalanceCents,minimumBalanceDate:current.minimumBalanceDate,shortfallCents:current.shortfallCents,unfulfilled:current.unfulfilled},options,
  assumptions:['未来工资与账单为模拟预测，不保证到账；工资次日作为目标投入试算日。','本页用同一日期账本同时试算全部目标；不把未来收入、待收或待结算算作当前资金。','月度方案为替换假设，保留已批准的一次性支出；确认只更新约束并暂停关联计划，不创建新的扣款权。','修复按低优先级优先减少投入；这是有界搜索，不声称所有维度的全局最优。',...(limited?['目标超出366天预测范围，当前不能给出可执行调整。']:[])],
  sourceRefs:[baseline.id,...baseline.evidenceRefs]};
}
