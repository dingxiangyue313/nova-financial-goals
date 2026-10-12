import { z } from "zod";

export const PlanStatusSchema = z.enum(["planned","checking","requires_approval","executing","completed","failed","cancelled"]);
export type PlanStatus = z.infer<typeof PlanStatusSchema>;
export const IntentSchema = z.object({
  intent:z.enum(["create_goal","update_goal","explain_cashflow","unknown"]),
  confidence:z.number().min(0).max(1),
  entities:z.object({
    name:z.string().trim().min(1).optional(),
    amount:z.number().int().positive().optional(),
    targetDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    currency:z.string().length(3).default("CNY"),
    protectedEmergencyFund:z.boolean().default(false),
    avoidSellingInvestments:z.boolean().default(false),
    monthlyContribution:z.number().int().positive().optional(),
  }),
});
export type ParsedIntent = z.infer<typeof IntentSchema>;

export const PlanSchema = z.object({
  id:z.string(),
  intent:IntentSchema.shape.intent,
  status:PlanStatusSchema,
  assumptions:z.array(z.string()),
  steps:z.array(z.object({ id:z.string(), tool:z.enum(["create_goal","prepare_internal_transfer","execute_internal_transfer"]), status:PlanStatusSchema, requiresApproval:z.boolean() })),
});
export type AgentPlan = z.infer<typeof PlanSchema>;

export function parseFinancialIntent(text:string):ParsedIntent{
  const normalized=text.trim();
  const amountMatch=normalized.match(/(?:¥|￥)?\s*([\d,]+)\s*(?:元)?/);
  const monthlyMatch=normalized.match(/每月\s*(?:¥|￥)?\s*([\d,]+)/);
  const mentionsGoal=/旅行|目标|预算|存|准备/.test(normalized);
  const update=/改成|调整|每月/.test(normalized);
  const destination=normalized.match(/(?:去|到)([^，。,.]{1,12}?)(?:旅行|旅游)/)?.[1]?.trim();
  const explicitName=normalized.match(/(?:创建|建立|准备)([^，。,.]{1,16}?)(?:目标)?(?:，|,|预算|$)/)?.[1]?.trim();
  const name=destination?`${destination}旅行`:explicitName||(/电脑/.test(normalized)?"购买电脑":/学习/.test(normalized)?"学习计划":undefined);
  const absoluteDate=normalized.match(/(20\d{2})[年/-](\d{1,2})[月/-](\d{1,2})日?/);
  const relativeMonths=normalized.match(/([一二三四五六七八九十\d]+)个?月后/);
  const chineseMonths:Record<string,number>={一:1,二:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9,十:10};
  const monthNumber=(value:string)=>/^\d+$/.test(value)?Number(value):(chineseMonths[value]??0);
  let targetDate:string|undefined;
  if(absoluteDate){targetDate=`${absoluteDate[1]}-${absoluteDate[2].padStart(2,"0")}-${absoluteDate[3].padStart(2,"0")}`}
  else if(relativeMonths){const date=new Date();date.setMonth(date.getMonth()+monthNumber(relativeMonths[1]));targetDate=date.toISOString().slice(0,10)}
  return IntentSchema.parse({
    intent:mentionsGoal?(update?"update_goal":"create_goal"):/还能.*花|现金流/.test(normalized)?"explain_cashflow":"unknown",
    confidence:mentionsGoal?0.96:0.72,
    entities:{
      name,
      amount:amountMatch?Number(amountMatch[1].replaceAll(",",""))*100:undefined,
      targetDate,
      currency:"CNY",
      protectedEmergencyFund:/不(?:能|要|想).*动.*应急金|保护.*应急金/.test(normalized),
      avoidSellingInvestments:/不(?:卖|想卖).*投资/.test(normalized),
      monthlyContribution:monthlyMatch?Number(monthlyMatch[1].replaceAll(",",""))*100:undefined,
    },
  });
}

export function createGoalPlan(intent:ParsedIntent):AgentPlan{
  return PlanSchema.parse({ id:"plan_japan_goal_001", intent:intent.intent, status:"planned", assumptions:[intent.entities.protectedEmergencyFund?"保护应急金":"使用当前安全余额线",intent.entities.avoidSellingInvestments?"不卖出投资":"优先使用现金流"], steps:[
    {id:"goal",tool:"create_goal",status:"planned",requiresApproval:true},
    {id:"prepare",tool:"prepare_internal_transfer",status:"planned",requiresApproval:false},
    {id:"execute",tool:"execute_internal_transfer",status:"planned",requiresApproval:true},
  ]});
}

const allowedTransitions:Record<PlanStatus,PlanStatus[]>={planned:["checking","cancelled"],checking:["requires_approval","executing","failed","cancelled"],requires_approval:["executing","cancelled"],executing:["completed","failed"],completed:[],failed:[],cancelled:[]};
export function transitionPlan(plan:AgentPlan,next:PlanStatus):AgentPlan{
  if(!allowedTransitions[plan.status].includes(next)) throw new Error(`非法计划状态转换：${plan.status} → ${next}`);
  return PlanSchema.parse({...plan,status:next});
}
