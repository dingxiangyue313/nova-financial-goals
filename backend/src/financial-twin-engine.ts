import { FinancialTwinStateSchema,type FinancialTwinState,type TwinAction } from "@backend/financial-twin-contracts";

const DAY=86_400_000;
const isoDay=(value:Date)=>value.toISOString().slice(0,10);
const addDays=(date:string,days:number)=>isoDay(new Date(new Date(`${date}T00:00:00Z`).getTime()+days*DAY));
export function goalPlanContributions(goal:FinancialTwinState["goals"][number],at=new Date()){
 const remaining=Math.max(0,goal.targetAmount-goal.savedAmount);
 const days=Math.max(1,Math.ceil((new Date(`${goal.targetDate}T00:00:00Z`).getTime()-at.getTime())/DAY));
 const months=Math.max(1,days/30);
 const round=(amount:number)=>Math.ceil(amount/1000)*1000;
 const balanced=round(remaining/months);
 return {conservative:round(balanced*.75),balanced,accelerated:round(balanced*1.35)};
}

export function createInitialTwin(at=new Date()):FinancialTwinState{
 const today=isoDay(at);const date=(days:number)=>isoDay(new Date(at.getTime()+days*DAY));
 return FinancialTwinStateSchema.parse({id:"twin_current",version:1,currency:"CNY",updatedAt:at.toISOString(),safetyBuffer:300000,
  accounts:[{id:"acc_checking_001",name:"日常活期 · 1024",type:"checking",balance:1000000,protected:false},{id:"acc_emergency_001",name:"应急金 · 8871",type:"savings",balance:1000000,protected:true},{id:"acc_goal_japan_001",name:"日本旅行目标",type:"goal",balance:496000,protected:false},{id:"acc_investment_001",name:"长期投资 · 3306",type:"investment",balance:1860000,protected:true}],
  cashflows:[{id:"cf_rent",date:date(7),label:"房租",category:"bill",amount:-168000,recurring:true,source:"fixture"},{id:"cf_essential",date:date(10),label:"必要生活支出",category:"essential",amount:-93200,recurring:false,source:"fixture"},{id:"cf_salary",date:date(15),label:"工资收入",category:"income",amount:1800000,recurring:true,source:"fixture"},{id:"cf_subscription",date:date(22),label:"订阅与通讯",category:"subscription",amount:-18800,recurring:true,source:"fixture"}],
  goals:[{id:"goal_japan_001",name:"日本旅行",targetAmount:800000,savedAmount:496000,targetDate:addDays(today,130),monthlyContribution:76000,priority:1,status:"active"},{id:"goal_emergency",name:"应急金",targetAmount:1200000,savedAmount:1000000,targetDate:addDays(today,365),monthlyContribution:30000,priority:0,status:"active"},{id:"goal_learning",name:"年度学习计划",targetAmount:180000,savedAmount:82000,targetDate:addDays(today,200),monthlyContribution:10000,priority:2,status:"active"}],
  mandate:{id:"mandate_japan_daily_001",version:1,status:"active",perTransactionLimit:50000,dailyLimit:80000,remainingLimit:118000},selectedPlan:null,activities:[{id:"activity_initial",type:"state_change",title:"模拟账户已同步",status:"succeeded",createdAt:at.toISOString(),details:"账户、现金流、目标与授权边界已同步。"}]});
}

export type CashflowForecast={asOf:string;horizonDays:number;startingBalance:number;projectedLowestBalance:number;projectedEndingBalance:number;safetyBuffer:number;availableAboveSafetyBuffer:number;safeToSpend:number;confidence:number;timeline:Array<{date:string;openingBalance:number;netChange:number;closingBalance:number;events:Array<{id:string;label:string;amount:number;category:string}>}>;goalCompetition:Array<{goalId:string;name:string;requested:number;allocated:number;shortfall:number;status:"funded"|"competing"|"deferred"}>;warnings:string[]};

export function forecastTwin(state:FinancialTwinState,horizonDays=30,hypothetical:FinancialTwinState["cashflows"]=[],at=new Date()):CashflowForecast{
 const checking=state.accounts.find(account=>account.type==="checking")?.balance??0;const start=isoDay(at);const end=isoDay(new Date(at.getTime()+horizonDays*DAY));
 const events=[...state.cashflows,...hypothetical].filter(event=>event.date>=start&&event.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
 const byDate=new Map<string,typeof events>();for(const event of events)byDate.set(event.date,[...(byDate.get(event.date)??[]),event]);
 let balance=checking;let lowest=checking;const timeline:CashflowForecast["timeline"]=[];
 for(let day=0;day<=horizonDays;day++){const date=isoDay(new Date(at.getTime()+day*DAY));const daily=byDate.get(date)??[];const openingBalance=balance;const netChange=daily.reduce((sum,event)=>sum+event.amount,0);balance+=netChange;lowest=Math.min(lowest,balance);if(daily.length||day===0||day===horizonDays)timeline.push({date,openingBalance,netChange,closingBalance:balance,events:daily.map(({id,label,amount,category})=>({id,label,amount,category}))});}
 const capacity=Math.max(0,lowest-state.safetyBuffer);let remaining=capacity;const goalCompetition=state.goals.filter(goal=>goal.status==="active").sort((a,b)=>a.priority-b.priority).map(goal=>{const requested=goal.monthlyContribution;const allocated=Math.min(requested,remaining);remaining-=allocated;return {goalId:goal.id,name:goal.name,requested,allocated,shortfall:requested-allocated,status:(allocated===requested?"funded":allocated>0?"competing":"deferred") as "funded"|"competing"|"deferred"};});
 const requiredGoals=goalCompetition.reduce((sum,goal)=>sum+goal.allocated,0);const safeToSpend=Math.max(0,capacity-requiredGoals);
 return {asOf:at.toISOString(),horizonDays,startingBalance:checking,projectedLowestBalance:lowest,projectedEndingBalance:balance,safetyBuffer:state.safetyBuffer,availableAboveSafetyBuffer:capacity,safeToSpend,confidence:.88,timeline,goalCompetition,warnings:[...(lowest<state.safetyBuffer?["预测期内余额将低于安全线"]:[]),...(goalCompetition.some(goal=>goal.shortfall>0)?["目标之间存在资金竞争"]:[])]};
}

export function simulateExpense(state:FinancialTwinState,amount:number,date=isoDay(new Date()),goalId?:string,strategy:"adjust_contribution"|"adjust_date"="adjust_contribution"){
 const event={id:"hypothetical_expense",date,label:"情景消费",category:"discretionary",amount:-amount,recurring:false,source:"user" as const};
 const before=forecastTwin(state);
 const after=forecastTwin(state,30,[event]);
 const goal=state.goals.find(item=>item.id===goalId)??state.goals.find(item=>item.priority>0);
 const remaining=goal?Math.max(0,goal.targetAmount-goal.savedAmount):0;
 const fundingLoss=Math.max(0,(after.goalCompetition.find(item=>item.goalId===goal?.id)?.shortfall??0)-(before.goalCompetition.find(item=>item.goalId===goal?.id)?.shortfall??0));
 const unabsorbed=Math.max(fundingLoss,amount-before.safeToSpend);
 const daysRemaining=goal?Math.max(1,Math.ceil((Date.parse(`${goal.targetDate}T00:00:00Z`)-Date.now())/DAY)):1;
 const monthsRemaining=Math.max(1,Math.ceil(daysRemaining/30));
 const monthly=goal?Math.max(1,goal.monthlyContribution):1;
 const completionDelayDays=goal?Math.ceil(unabsorbed/monthly*30):0;
 const impactRatio=remaining?amount/remaining:0;
 const qualifies=Boolean(goal&&goal.status==="active"&&(amount>=50000||impactRatio>=.05)&&(after.safeToSpend<before.safeToSpend||completionDelayDays>0));
 return {before,after,impact:{amount,goalId:goal?.id??null,strategy,completionDelayDays,recommendedMonthlyAdjustment:strategy==="adjust_contribution"?Math.ceil(unabsorbed/monthsRemaining):0,recommendedTargetDate:strategy==="adjust_date"&&goal?addDays(goal.targetDate,completionDelayDays):goal?.targetDate??null,safetyBufferBreached:after.projectedLowestBalance<state.safetyBuffer,goalFundingGap:after.goalCompetition.find(item=>item.goalId===goal?.id)?.shortfall??0,impactRatio,qualifies,safeToSpendBefore:before.safeToSpend,safeToSpendAfter:after.safeToSpend}};
}

export function applyTwinAction(state:FinancialTwinState,action:Exclude<TwinAction,{type:"simulate_expense"}>):FinancialTwinState{
 const next=structuredClone(state);next.version+=1;next.updatedAt=new Date().toISOString();const activity=(item:FinancialTwinState["activities"][number])=>{next.activities=[item,...next.activities].slice(0,100)};
 if(action.type==="record_expense"){const account=next.accounts.find(item=>item.type==="checking");if(!account||account.balance<action.amount)throw new Error("BALANCE_INSUFFICIENT");account.balance-=action.amount;if(["transport","dining","shopping"].includes(action.category))next.mandate.remainingLimit=Math.max(0,next.mandate.remainingLimit-action.amount);next.cashflows.push({id:`cf_${crypto.randomUUID()}`,date:isoDay(new Date()),label:action.merchant,category:action.category,amount:-action.amount,recurring:false,source:"tool"});activity({id:`activity_${crypto.randomUUID()}`,type:"execution",title:`${action.merchant} 支出已记账`,status:"succeeded",amount:action.amount,operationId:action.operationId,createdAt:next.updatedAt,details:"账户余额、现金流预测和目标竞争已重新计算。"});}
 if(action.type==="record_transfer"){const source=next.accounts.find(item=>item.id===action.sourceAccountId);const destination=next.accounts.find(item=>item.id===action.destinationAccountId);if(!source||!destination||source.id===destination.id||source.protected||destination.protected||source.type!=="checking"||destination.type!=="goal")throw new Error("TRANSFER_ACCOUNT_INVALID");if(source.balance<action.amount)throw new Error("BALANCE_INSUFFICIENT");source.balance-=action.amount;destination.balance+=action.amount;const goal=next.goals.find(item=>item.id===destination.id.replace(/^acc_/,"")||destination.name.includes(item.name));if(goal)goal.savedAmount+=action.amount;activity({id:`activity_${crypto.randomUUID()}`,type:"execution",title:`向${destination.name}转入 ${action.amount/100} 元`,status:"succeeded",amount:action.amount,operationId:action.operationId,createdAt:next.updatedAt,details:"内部模拟转账已同时更新转出和转入账户，总资产不变。"});}
 if(action.type==="select_goal_plan"){next.selectedPlan=action.plan;const goal=next.goals.find(item=>item.id===action.goalId);if(!goal)throw new Error("GOAL_NOT_FOUND");goal.selectedPlan=action.plan;goal.monthlyContribution=goalPlanContributions(goal)[action.plan];activity({id:`activity_${crypto.randomUUID()}`,type:"state_change",title:`${goal.name}方案已更新`,status:"succeeded",createdAt:next.updatedAt,details:`当前方案：${action.plan}，月投入 ¥${goal.monthlyContribution/100}。`});}
 if(action.type==="activate_goal"){const goal=next.goals.find(item=>item.id===action.goalId);if(!goal)throw new Error("GOAL_NOT_FOUND");if(!goal.selectedPlan)throw new Error("GOAL_PLAN_NOT_SELECTED");goal.status="active";activity({id:`activity_${crypto.randomUUID()}`,type:"approval",title:`${goal.name}计划已激活`,status:"succeeded",createdAt:next.updatedAt,details:"激活目标监测，不代表授权自动转账。"});}
 if(action.type==="create_goal"){next.goals.push({...action.goal,selectedPlan:null});next.selectedPlan=null;activity({id:`activity_${crypto.randomUUID()}`,type:"approval",title:`${action.goal.name}目标已创建`,status:"succeeded",createdAt:next.updatedAt,details:`目标金额 ¥${action.goal.targetAmount/100}，已通过逐次审批创建。`});}
 if(action.type==="update_goal"){const goal=next.goals.find(item=>item.id===action.goalId);if(!goal)throw new Error("GOAL_NOT_FOUND");if(action.changes.targetAmount!==undefined)goal.targetAmount=action.changes.targetAmount;if(action.changes.targetDate!==undefined)goal.targetDate=action.changes.targetDate;if(action.changes.monthlyContribution!==undefined)goal.monthlyContribution=action.changes.monthlyContribution;else if((action.changes.targetAmount!==undefined||action.changes.targetDate!==undefined)&&goal.selectedPlan)goal.monthlyContribution=goalPlanContributions(goal)[goal.selectedPlan];if(action.changes.targetAmount!==undefined||action.changes.targetDate!==undefined){goal.selectedPlan=null;next.selectedPlan=null;}activity({id:`activity_${crypto.randomUUID()}`,type:"approval",title:`${goal.name}目标已调整`,status:"succeeded",createdAt:next.updatedAt,details:`目标金额 ¥${goal.targetAmount/100}，月投入 ¥${goal.monthlyContribution/100}；现金流与目标竞争已重新计算。`});}
 if(action.type==="resolve_shopping"){if(action.decision==="approved"){const account=next.accounts.find(item=>item.type==="checking");if(!account||account.balance<action.amount)throw new Error("BALANCE_INSUFFICIENT");account.balance-=action.amount;next.mandate.remainingLimit=Math.max(0,next.mandate.remainingLimit-action.amount);next.cashflows.push({id:`cf_${crypto.randomUUID()}`,date:isoDay(new Date()),label:action.merchant,category:"shopping",amount:-action.amount,recurring:false,source:"tool"});}activity({id:`activity_${crypto.randomUUID()}`,type:action.decision==="approved"?"execution":"approval",title:action.decision==="approved"?`${action.merchant} ¥${action.amount/100} 已确认`:`${action.merchant} 请求已拒绝`,status:action.decision==="approved"?"succeeded":"cancelled",amount:action.amount,createdAt:next.updatedAt,details:action.decision==="approved"?"逐笔确认后写入 Financial Twin。":"未调用支付工具，资金状态不变。"});}
 if(action.type==="update_mandate"){next.mandate={...next.mandate,id:action.id??next.mandate.id,status:action.status,perTransactionLimit:action.perTransactionLimit,dailyLimit:action.dailyLimit,remainingLimit:action.remainingLimit,version:next.mandate.version+1};activity({id:`activity_${crypto.randomUUID()}`,type:"approval",title:"Mandate 已更新",status:"succeeded",createdAt:next.updatedAt,details:`授权版本 v${next.mandate.version}，状态 ${next.mandate.status}。`});}
 return FinancialTwinStateSchema.parse(next);
}
