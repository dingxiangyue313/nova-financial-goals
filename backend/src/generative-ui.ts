import { z } from "zod";
import fixture from "@backend/demo-fixtures.json";
import type { FinancialTwinState } from "./financial-twin-contracts";
import type { CashflowForecast } from "./financial-twin-engine";
import { getGoalReadiness } from "./goal-readiness";

export const AllowedIntentSchema=z.enum(["select_goal_scenario","request_goal_approval","explain_goal_impact","edit_goal","review_external_request","approve_external_request","view_mandate","verify_operation","retry_safely"]);
const Amount=z.object({amount:z.number().int(),currency:z.string().length(3)});
const Action=z.object({intent:AllowedIntentSchema,label:z.string().min(1),riskClass:z.enum(["read","planning","money_movement"]),requiresApproval:z.boolean(),payload:z.record(z.string()).optional()});
const Base=z.object({id:z.string().min(1),title:z.string().min(1),actions:z.array(Action)});
const Tone=z.enum(["neutral","positive","warning","danger"]);
const schemas=[
 Base.extend({type:z.literal("brief_card"),data:z.object({summary:z.string(),signals:z.array(z.object({label:z.string(),priority:z.enum(["high","medium","low"])})).min(1)})}),
 Base.extend({type:z.literal("insight_card"),data:z.object({body:z.string(),evidence:z.array(z.string()).min(1),tone:Tone})}),
 Base.extend({type:z.literal("metric_strip"),data:z.object({metrics:z.array(z.object({label:z.string(),value:Amount,note:z.string().optional()})).min(2).max(4)})}),
 Base.extend({type:z.literal("cashflow_timeline"),data:z.object({openingBalance:Amount,events:z.array(z.object({date:z.string(),label:z.string(),amount:Amount,tone:Tone})).min(1),closingBalance:Amount})}),
 Base.extend({type:z.literal("goal_simulator"),data:z.object({target:Amount,saved:Amount,monthlyContribution:Amount,targetDate:z.string(),selectedPlan:z.string()})}),
 Base.extend({type:z.literal("scenario_compare"),data:z.object({selectedId:z.string().nullable(),scenarios:z.array(z.object({id:z.string(),name:z.string(),monthlyContribution:Amount,completionDate:z.string(),impact:z.string(),recommended:z.boolean()})).min(1).max(3)})}),
 Base.extend({type:z.literal("goal_progress_card"),data:z.object({goalId:z.string(),saved:Amount,target:Amount,targetDate:z.string(),progressPercent:z.number().min(0).max(100),status:z.enum(["insufficient_data","on_track","at_risk","infeasible"])})}),
 Base.extend({type:z.literal("goal_feasibility_card"),data:z.object({goalId:z.string(),status:z.enum(["insufficient_data","on_track","at_risk","infeasible"]),monthlyRequired:Amount,availableMonthly:Amount,missing:z.array(z.string()),updatedAt:z.string()})}),
 Base.extend({type:z.literal("goal_impact_signal"),data:z.object({goalId:z.string(),expense:Amount,completionDelayDays:z.number().int().nonnegative(),safeToSpendBefore:Amount,safeToSpendAfter:Amount,qualifies:z.boolean()})}),
 Base.extend({type:z.literal("allocation_chart"),data:z.object({total:Amount,segments:z.array(z.object({label:z.string(),amount:Amount,color:z.string().regex(/^#[0-9a-fA-F]{6}$/)})).min(1)})}),
 Base.extend({type:z.literal("impact_summary"),data:z.object({items:z.array(z.object({label:z.string(),value:z.string(),tone:z.enum(["neutral","positive","warning"])})).min(1)})}),
 Base.extend({type:z.literal("plan_steps"),data:z.object({steps:z.array(z.object({id:z.string(),label:z.string(),status:z.enum(["planned","checking","requires_approval","executing","completed","failed","cancelled"])}))})}),
 Base.extend({type:z.literal("external_agent_request"),data:z.object({agent:z.string(),verified:z.boolean(),merchant:z.string(),purpose:z.string(),amount:Amount,time:z.string()})}),
 Base.extend({type:z.literal("mandate_match"),data:z.object({mandate:z.string(),decision:z.enum(["execute","ask","block"]),matchedRules:z.array(z.string()),remainingLimit:Amount})}),
 Base.extend({type:z.literal("approval_sheet"),data:z.object({operation:z.string(),source:z.string(),destination:z.string(),amount:Amount,fee:Amount,timing:z.string(),snapshotHash:z.string(),reason:z.string()})}),
 Base.extend({type:z.literal("risk_disclosure"),data:z.object({level:z.enum(["low","medium","high"]),risks:z.array(z.string()).min(1),mitigations:z.array(z.string()).min(1)})}),
 Base.extend({type:z.literal("execution_receipt"),data:z.object({operationId:z.string(),tool:z.string(),status:z.enum(["succeeded","unknown","failed"]),amount:Amount,fee:Amount,timestamp:z.string()})}),
 Base.extend({type:z.literal("error_recovery"),data:z.object({code:z.string(),message:z.string(),safeNextStep:z.string(),operationId:z.string().optional()})}),
] as const;
export const GeneratedComponentSchema=z.discriminatedUnion("type",schemas);
export const GeneratedCanvasSchema=z.array(GeneratedComponentSchema).min(1).max(16).superRefine((items,ctx)=>{const ids=new Set<string>();items.forEach((item,index)=>{if(ids.has(item.id))ctx.addIssue({code:"custom",path:[index,"id"],message:"component id must be unique"});ids.add(item.id);item.actions.forEach((action,actionIndex)=>{if(action.riskClass==="money_movement"&&!action.requiresApproval)ctx.addIssue({code:"custom",path:[index,"actions",actionIndex,"requiresApproval"],message:"money movement requires explicit approval"});});});});
export type GeneratedComponent=z.infer<typeof GeneratedComponentSchema>;
export type AllowedIntent=z.infer<typeof AllowedIntentSchema>;
const act=(intent:AllowedIntent,label:string,riskClass:"read"|"planning"|"money_movement"="read",requiresApproval=false,payload?:Record<string,string>)=>({intent,label,riskClass,requiresApproval,payload});

/** Live goal components use the persisted Financial Twin as their sole data source. */
export function buildLiveGoalCanvas(state:FinancialTwinState,forecast:CashflowForecast,goalId:string,context:"home"|"feasibility"|"impact"="home",impact?:{amount:number;completionDelayDays:number;safeToSpendBefore:number;safeToSpendAfter:number;qualifies:boolean}){
 const goal=state.goals.find(item=>item.id===goalId);
 if(!goal)throw new Error("GOAL_NOT_FOUND");
 const readiness=getGoalReadiness(state,goalId,forecast);
 const amount=(value:number)=>({amount:Math.round(value),currency:"CNY"});
 const labels={conservative:"保守",balanced:"平衡",accelerated:"加速"};
 const progress={id:`${goalId}-progress`,type:"goal_progress_card",title:goal.name,data:{goalId,saved:amount(goal.savedAmount),target:amount(goal.targetAmount),targetDate:goal.targetDate,progressPercent:goal.targetAmount?Math.min(100,Math.round(goal.savedAmount/goal.targetAmount*100)):0,status:readiness.status},actions:[act("edit_goal","调整目标","planning",false,{goalId})]};
 const feasibility={id:`${goalId}-feasibility`,type:"goal_feasibility_card",title:"这个目标能按时实现吗？",data:{goalId,status:readiness.status,monthlyRequired:amount(readiness.monthlyRequired),availableMonthly:amount(readiness.availableMonthly),missing:readiness.missing,updatedAt:readiness.updatedAt},actions:[]};
 const scenarios={id:`${goalId}-scenarios`,type:"scenario_compare",title:"选择适合你的节奏",data:{selectedId:readiness.selectedPlan,scenarios:readiness.options.map(option=>({id:option.id,name:labels[option.id],monthlyContribution:amount(option.monthlyContribution),completionDate:option.projectedDate,impact:option.withinSafeBalance?option.onTime?"在安全余额内按时推进":"安全余额内，完成日可能晚于目标日":"当前现金流不足以支持此投入",recommended:option.id==="balanced"}))},actions:[act("select_goal_scenario","选择方案","planning",false,{goalId})]};
 const signal=impact?{id:`${goalId}-impact`,type:"goal_impact_signal",title:impact.completionDelayDays?"这笔支出可能推迟目标":"本月可支配余量发生变化",data:{goalId,expense:amount(impact.amount),completionDelayDays:impact.completionDelayDays,safeToSpendBefore:amount(impact.safeToSpendBefore),safeToSpendAfter:amount(impact.safeToSpendAfter),qualifies:impact.qualifies},actions:[act("explain_goal_impact","查看调整方案","read",false,{goalId})]}:null;
 const canvas=context==="home"?[progress,feasibility,...(signal?.data.qualifies?[signal]:[])]:context==="impact"?[...(signal?[signal]:[]),feasibility,scenarios]:[feasibility,scenarios];
 return GeneratedCanvasSchema.parse(canvas);
}

export function buildGoalCanvas(selectedPlan:"保守"|"平衡"|"加速",context:"goal"|"trust"|"recovery"="goal"):unknown{
 const names:Record<string,"保守"|"平衡"|"加速">={scenario_conservative:"保守",scenario_balanced:"平衡",scenario_accelerated:"加速"};
 const selectedId=Object.entries(names).find(([,name])=>name===selectedPlan)?.[0]??"scenario_balanced";
 const base=[
  {id:"daily-brief",type:"brief_card",title:"今日计划摘要",data:{summary:`${selectedPlan}方案保持应急金受保护，并在目标日前完成旅行储备。`,signals:[{label:"目标进度 62%",priority:"high"},{label:"本月现金流稳定",priority:"medium"}]},actions:[act("explain_goal_impact","查看依据")]},
  {id:"goal-insight",type:"insight_card",title:"为什么推荐这个节奏",data:{body:"方案综合考虑固定账单、安全余额与不卖出长期投资的约束。",evidence:["未来 30 天可安心支配 ¥1,570","应急金 ¥10,000 受保护"],tone:"positive"},actions:[]},
  {id:"goal-metrics",type:"metric_strip",title:"目标概览",data:{metrics:[{label:"目标金额",value:{amount:fixture.goal.targetAmount,currency:"CNY"},note:"日本旅行"},{label:"已积累",value:{amount:fixture.goal.savedAmount,currency:"CNY"},note:`完成 ${fixture.goal.progressPercent}%`},{label:"尚待积累",value:{amount:fixture.goal.remainingAmount,currency:"CNY"},note:"不动用应急金"}]},actions:[]},
  {id:"cashflow",type:"cashflow_timeline",title:"未来现金流",data:{openingBalance:{amount:620000,currency:"CNY"},events:[{date:"09-23",label:"StreamPlus",amount:{amount:-5500,currency:"CNY"},tone:"warning"},{date:"09-25",label:"工资",amount:{amount:980000,currency:"CNY"},tone:"positive"},{date:"10-25",label:"旅行目标转入",amount:{amount:-76000,currency:"CNY"},tone:"neutral"}],closingBalance:{amount:1379000,currency:"CNY"}},actions:[]},
  {id:"goal-simulator",type:"goal_simulator",title:"目标参数",data:{target:{amount:fixture.goal.targetAmount,currency:"CNY"},saved:{amount:fixture.goal.savedAmount,currency:"CNY"},monthlyContribution:{amount:selectedPlan==="保守"?61000:selectedPlan==="加速"?99000:76000,currency:"CNY"},targetDate:"2027-02-28",selectedPlan},actions:[act("edit_goal","调整目标参数","planning")]},
  {id:"goal-scenarios",type:"scenario_compare",title:"选择你的节奏",data:{selectedId,scenarios:fixture.goalScenarios.map(s=>({id:s.id,name:names[s.id],monthlyContribution:{amount:s.monthlyContribution,currency:"CNY"},completionDate:s.completionDate,impact:"warning" in s?s.warning:"保持当前安全余额",recommended:s.recommended}))},actions:[act("select_goal_scenario","选择方案","planning")]},
  {id:"allocation",type:"allocation_chart",title:"旅行资金来源",data:{total:{amount:fixture.goal.savedAmount,currency:"CNY"},segments:[{label:"旅行钱包",amount:{amount:320000,currency:"CNY"},color:"#1769d2"},{label:"未来转入",amount:{amount:176000,currency:"CNY"},color:"#76b5ff"}]},actions:[]},
  {id:"goal-impact",type:"impact_summary",title:"约束与影响",data:{items:[{label:"应急金",value:"¥10,000 保持受保护",tone:"positive"},{label:"长期投资",value:"不卖出",tone:"positive"},{label:"当前选择",value:`${selectedPlan}方案`,tone:selectedPlan==="加速"?"warning":"neutral"}]},actions:[act("explain_goal_impact","查看影响依据")]},
  {id:"goal-plan",type:"plan_steps",title:"执行步骤",data:{steps:[{id:"read",label:"读取财务映射",status:"completed"},{id:"compare",label:"比较三个方案",status:"completed"},{id:"approve",label:`确认${selectedPlan}方案`,status:"requires_approval"},{id:"create",label:"创建模拟转入计划",status:"planned"}]},actions:[act("request_goal_approval",`激活${selectedPlan}方案`,"money_movement",true)]},
 ];
 const trust=[
  {id:"external-request",type:"external_agent_request",title:"外部 Agent 请求",data:{agent:"WanderMate Travel Agent",verified:true,merchant:"Shibuya Loft",purpose:"旅行用品",amount:{amount:24000,currency:"CNY"},time:"2026-10-08 14:30"},actions:[act("review_external_request","检查请求")]},
  {id:"mandate-match",type:"mandate_match",title:"Mandate 匹配",data:{mandate:"Japan Trip Mandate v1",decision:"ask",matchedRules:["请求方已验证","类别为购物，必须询问"],remainingLimit:{amount:276000,currency:"CNY"}},actions:[act("view_mandate","查看授权边界")]},
  {id:"approval",type:"approval_sheet",title:"明确授权",data:{operation:"模拟支付旅行用品",source:"NOVA Travel Wallet",destination:"Shibuya Loft",amount:{amount:24000,currency:"CNY"},fee:{amount:0,currency:"CNY"},timing:"确认后立即",snapshotHash:"sha256:9bd1…42ac",reason:"购物请求必须逐笔确认"},actions:[act("approve_external_request","确认模拟支付","money_movement",true)]},
  {id:"risk",type:"risk_disclosure",title:"风险与限制",data:{level:"medium",risks:["会减少旅行预算 ¥240","确认后写入审计记录"],mitigations:["不会动用应急金","可在确认前取消"]},actions:[]},
  {id:"receipt",type:"execution_receipt",title:"执行凭证",data:{operationId:"op_demo_001",tool:"simulate_external_payment",status:"succeeded",amount:{amount:18000,currency:"CNY"},fee:{amount:0,currency:"CNY"},timestamp:"2026-09-20 09:42"},actions:[]},
 ];
 if(context==="goal")return [...base,...trust,{id:"recovery",type:"error_recovery",title:"安全恢复示例",data:{code:"SAFE_RECOVERY_READY",message:"如工具状态无法确认，NOVA 不会把操作标记为成功。",safeNextStep:"使用原 Operation ID 查询状态后再决定是否重试。",operationId:"op_demo_001"},actions:[act("verify_operation","查看恢复方式")]}];
 if(context==="trust")return trust;
 return [{id:"recovery",type:"error_recovery",title:"安全恢复",data:{code:"TOOL_TIMEOUT",message:"工具在超时前未返回最终状态，因此不能显示为成功。",safeNextStep:"使用原 Operation ID 查询最新状态，避免重复支付。",operationId:"op_timeout_001"},actions:[act("verify_operation","查询最新状态")]},...trust.slice(0,2)];
}
export function buildInvalidCanvas():unknown{return [{id:"unsafe-001",type:"arbitrary_html",title:"未知组件",data:{html:"<button>execute</button>"},actions:[{intent:"execute_internal_transfer"}]}];}
