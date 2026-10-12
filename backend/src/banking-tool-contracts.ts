import { z } from "zod";

const money=z.number().int().nonnegative();
const currency=z.string().length(3).default("CNY");
const base=z.object({userId:z.string().optional()});
const schemas={
  get_financial_snapshot:base.extend({include:z.array(z.enum(["accounts","cashflow","goals","mandates"])).default(["accounts","cashflow","goals","mandates"])}),
  list_accounts:base.extend({accountTypes:z.array(z.string()).optional()}),
  list_transactions:z.object({accountId:z.string(),from:z.string().optional(),to:z.string().optional(),categories:z.array(z.string()).optional(),limit:z.number().int().min(1).max(100).default(50)}),
  forecast_cashflow:z.object({snapshotId:z.string(),horizonDays:z.number().int().min(1).max(365).default(30),hypotheticalChanges:z.array(z.object({type:z.string(),amount:money,currency})).default([])}),
  simulate_goal_plan:z.object({snapshotId:z.string(),name:z.string().min(1),targetAmount:money,currency,targetDate:z.string(),monthlyContributionLimit:money.optional(),protectedAccountIds:z.array(z.string()).default([]),allowInvestmentSale:z.boolean().default(false)}),
  create_goal:base.extend({planId:z.string(),name:z.string(),targetAmount:money,currency,targetDate:z.string(),protectedAccountIds:z.array(z.string()).default([]),approvalToken:z.string(),idempotencyKey:z.string()}),
  prepare_transfer:z.object({snapshotId:z.string(),sourceAccountId:z.string(),destinationAccountId:z.string(),amount:money.positive(),currency,schedule:z.object({type:z.enum(["once","monthly"]),firstExecutionDate:z.string()})}),
  execute_transfer:z.object({transferDraftId:z.string(),snapshotId:z.string(),allowSafetyBufferException:z.boolean().optional(),approvalToken:z.string(),idempotencyKey:z.string()}),
  get_operation_status:z.object({operationId:z.string()}),
  start_timeout_demo:z.object({idempotencyKey:z.string()}),
  run_security_scenario:z.object({scenario:z.enum(["replay","expired_mandate","invalid_signature","high_risk","timeout"])}),
  get_security_trace:z.object({traceId:z.string()}),
  execute_life_payment:z.object({requestId:z.string(),merchant:z.string(),category:z.enum(["transport","shopping","dining"]),amount:money.positive(),approvalToken:z.string().optional(),idempotencyKey:z.string()}),
  create_mandate:base.extend({agentId:z.string(),validFrom:z.string(),validTo:z.string(),rules:z.array(z.object({category:z.string(),decision:z.enum(["execute","ask","block"]),perTransactionLimit:money.optional(),dailyLimit:money.optional()})),tripTotalLimit:money,approvalToken:z.string(),idempotencyKey:z.string()}),
  list_mandates:base,
  evaluate_agent_payment:z.object({requestId:z.string(),agentId:z.string(),mandateId:z.string(),mandateVersion:z.number().int().positive().optional(),nonce:z.string().min(8),merchant:z.object({id:z.string(),name:z.string(),category:z.string()}),amount:money.positive(),currency,purpose:z.string(),requestedAt:z.string(),signature:z.string()}),
  execute_agent_payment:z.object({requestId:z.string(),decisionId:z.string(),approvalToken:z.string().nullable().optional(),idempotencyKey:z.string()}),
  create_approval_snapshot:z.object({action:z.string(),parameters:z.record(z.string(),z.unknown()),expiresInSeconds:z.number().int().min(60).max(1800).default(300)}),
  confirm_approval:z.object({approvalId:z.string(),snapshotHash:z.string(),confirmed:z.literal(true)}),
  permission_check:z.object({action:z.string(),parameters:z.record(z.string(),z.unknown()),approvalToken:z.string().optional(),mandateId:z.string().optional()}),
  risk_check:z.object({action:z.string(),amount:money.optional(),snapshotId:z.string().optional(),sourceAccountId:z.string().optional(),idempotencyKey:z.string().optional()}),
  append_audit_event:z.object({eventType:z.string(),objectId:z.string(),status:z.string(),metadata:z.record(z.string(),z.unknown()).default({})}),
  detect_financial_signals:z.object({snapshotId:z.string()}),
  explain_decision:z.object({decisionId:z.string()}),
  compare_scenarios:z.object({scenarios:z.array(z.object({name:z.string(),monthlyContribution:money,targetDate:z.string()})).min(1).max(3)}),
  get_goal_progress:z.object({goalId:z.string()}),
  pause_mandate:z.object({mandateId:z.string(),approvalToken:z.string()}),
  revoke_mandate:z.object({mandateId:z.string(),approvalToken:z.string()}),
  list_bills:base.extend({dueWithinDays:z.number().int().min(1).max(365).default(30)}),
  list_subscriptions:base.extend({status:z.enum(["active","cancelled","all"]).default("active")}),
  compare_cards:z.object({destination:z.string(),spendAmount:money,currency}),
  quote_fx:z.object({fromCurrency:z.string().length(3),toCurrency:z.string().length(3),amount:money.positive()}),
  prepare_fx_order:z.object({quoteId:z.string(),sourceAccountId:z.string(),destinationAccountId:z.string()}),
  execute_fx_order:z.object({fxDraftId:z.string(),approvalToken:z.string(),idempotencyKey:z.string()}),
  export_audit_report:z.object({from:z.string().optional(),to:z.string().optional(),format:z.enum(["json","csv"]).default("json")}),
  get_accounts:base.extend({accountTypes:z.array(z.string()).optional()}),
  get_transactions:z.object({accountId:z.string(),from:z.string().optional(),to:z.string().optional(),categories:z.array(z.string()).optional(),limit:z.number().int().min(1).max(100).default(50)}),
  get_upcoming_bills:base.extend({dueWithinDays:z.number().int().min(1).max(365).default(30)}),
  assess_goal_feasibility:z.object({scenarioId:z.string(),intent:z.object({name:z.string(),targetAmount:z.object({amount:money,currency}),targetDate:z.string(),monthlyContributionLimit:z.object({amount:money,currency}).nullable(),protectedAccountIds:z.array(z.string()),allowInvestmentSale:z.boolean(),safetyBuffer:z.object({amount:money,currency})})}),
  update_goal:z.object({goalId:z.string(),changes:z.record(z.string(),z.unknown()),approvalToken:z.string(),idempotencyKey:z.string()}),
  activate_goal:z.object({goalId:z.string(),selectedPlan:z.enum(["conservative","balanced","accelerated"]),twinVersion:z.number().int().positive(),approvalToken:z.string(),idempotencyKey:z.string()}),
  prepare_goal_adjustment:z.object({goalId:z.string(),strategy:z.enum(["increase_contribution","extend_date","reduce_target"]),value:z.union([money,z.string()])}),
  prepare_internal_transfer:z.object({snapshotId:z.string(),sourceAccountId:z.string(),destinationAccountId:z.string(),amount:money.positive(),currency,schedule:z.object({type:z.enum(["once","monthly"]),firstExecutionDate:z.string()})}),
  execute_internal_transfer:z.object({transferDraftId:z.string(),snapshotId:z.string(),approvalToken:z.string(),idempotencyKey:z.string()}),
  create_recurring_mandate:base.extend({agentId:z.string(),validFrom:z.string(),validTo:z.string(),rules:z.array(z.object({category:z.string(),decision:z.enum(["execute","ask","block"]),perTransactionLimit:money.optional(),dailyLimit:money.optional()})),tripTotalLimit:money,approvalToken:z.string(),idempotencyKey:z.string()}),
  evaluate_external_agent_request:z.object({requestId:z.string(),agentId:z.string(),mandateId:z.string(),mandateVersion:z.number().int().positive().optional(),nonce:z.string().min(8),merchant:z.object({id:z.string(),name:z.string(),category:z.string()}),amount:money.positive(),currency,purpose:z.string(),requestedAt:z.string(),signature:z.string()}),
  execute_external_payment:z.object({requestId:z.string(),decisionId:z.string(),approvalToken:z.string().nullable().optional(),idempotencyKey:z.string()}),
  get_activity:z.object({limit:z.number().int().min(1).max(100).default(50)}),
} satisfies Record<string,z.ZodTypeAny>;

export type BankingToolName=keyof typeof schemas;
export const bankingToolSchemas:Record<BankingToolName,z.ZodTypeAny>=schemas;
function toJsonSchema(schema:z.ZodTypeAny):Record<string,unknown>{
 const d=(schema as any)._def;const kind=d.typeName as string;
 if(kind==="ZodDefault"||kind==="ZodOptional"||kind==="ZodNullable")return toJsonSchema(d.innerType);
 if(kind==="ZodString")return {type:"string"};
 if(kind==="ZodNumber")return {type:"integer"};
 if(kind==="ZodBoolean")return {type:"boolean"};
 if(kind==="ZodLiteral")return {const:d.value};
 if(kind==="ZodEnum")return {type:"string",enum:d.values};
 if(kind==="ZodArray")return {type:"array",items:toJsonSchema(d.type)};
 if(kind==="ZodRecord")return {type:"object",additionalProperties:toJsonSchema(d.valueType)};
 if(kind==="ZodObject"){
  const shape=d.shape();const properties:Record<string,unknown>={};const required:string[]=[];
  for(const [key,value] of Object.entries(shape)){properties[key]=toJsonSchema(value as z.ZodTypeAny);const k=(value as any)._def.typeName;if(k!=="ZodOptional"&&k!=="ZodDefault")required.push(key)}
  return {type:"object",properties,required,additionalProperties:false};
 }
 return {};
}
const readOnly=new Set<BankingToolName>(["get_financial_snapshot","list_accounts","list_transactions","forecast_cashflow","simulate_goal_plan","get_operation_status","get_security_trace","list_mandates","permission_check","risk_check","detect_financial_signals","explain_decision","compare_scenarios","get_goal_progress","list_bills","list_subscriptions","compare_cards","quote_fx","export_audit_report","get_accounts","get_transactions","get_upcoming_bills","assess_goal_feasibility","prepare_goal_adjustment","get_activity"]);
const descriptions:Partial<Record<BankingToolName,string>>={
  get_financial_snapshot:"读取带新鲜度标记的 Financial Twin 快照",list_accounts:"列出脱敏账户和可用余额",list_transactions:"查询限定范围内的交易",forecast_cashflow:"预测现金流、安全余额与目标影响",simulate_goal_plan:"比较最多三个目标方案",create_goal:"在审批后创建目标",activate_goal:"审批后激活目标监测，不自动转账",prepare_transfer:"准备转账并计算影响，不移动资金",execute_transfer:"在审批、权限和风险检查后执行模拟转账",get_operation_status:"按原 Operation ID 查询状态",start_timeout_demo:"创建状态未知操作以验证原 Operation ID 查询",run_security_scenario:"在服务端运行真实安全攻击场景",get_security_trace:"按 Trace ID 读取关联安全证据",execute_life_payment:"按 Mandate、审批和 Financial Twin 风险执行生活场景沙箱支付",create_mandate:"创建版本化有限授权",list_mandates:"读取当前用户创建的 Mandate",evaluate_agent_payment:"将外部支付判断为 Execute、Ask 或 Block",execute_agent_payment:"执行已通过治理的外部 Agent 模拟支付",create_approval_snapshot:"冻结用户将要确认的参数",confirm_approval:"由用户明确确认审批快照",permission_check:"检查审批或 Mandate 是否覆盖操作",risk_check:"检查余额、快照、重复执行和受保护资金",append_audit_event:"写入不可修改的审计事件",detect_financial_signals:"发现异常消费、账单、订阅和目标风险",explain_decision:"基于真实检查证据解释决策",compare_scenarios:"比较最多三个财务方案",get_goal_progress:"读取目标进度和预测偏差",pause_mandate:"暂停授权",revoke_mandate:"永久撤销授权",list_bills:"读取未来账单",list_subscriptions:"读取订阅与价格变化",compare_cards:"比较旅行卡片费用",quote_fx:"生成限时模拟外汇报价",prepare_fx_order:"准备换汇订单",execute_fx_order:"审批后执行模拟换汇",export_audit_report:"导出审计证据"
};

export const bankingToolDefinitions=(Object.keys(schemas) as BankingToolName[]).map(name=>({name,description:descriptions[name]??`NOVA Goal-first Banking Tool: ${name}`,inputSchema:toJsonSchema(schemas[name]),annotations:{readOnlyHint:readOnly.has(name),destructiveHint:name==="revoke_mandate"}}));
