import { z } from "zod";

export const MoneySchema=z.object({amount:z.number().int().nonnegative(),currency:z.string().length(3).default("CNY")});
export const GoalFeasibilityStatusSchema=z.enum(["insufficient_data","on_track","at_risk","infeasible"]);
export const GoalFeasibilitySchema=z.object({
 id:z.string(),goalId:z.string(),status:GoalFeasibilityStatusSchema,
 projectedCompletionDate:z.object({earliest:z.string(),latest:z.string()}).nullable(),
 requiredContribution:MoneySchema.extend({cycle:z.enum(["weekly","monthly"])}).nullable(),
 availableAdjustmentRange:z.object({targetAmount:z.object({min:MoneySchema,max:MoneySchema}),targetDate:z.object({earliest:z.string(),latest:z.string()}),contribution:z.object({min:MoneySchema,max:MoneySchema})}),
 protectedFundsImpact:z.enum(["none","approaches_protected_funds","uses_protected_funds"]),
 safeToSpendImpact:z.object({before:MoneySchema,after:MoneySchema,delta:MoneySchema.extend({direction:z.enum(["increase","decrease","unchanged"])})}),
 assumptions:z.array(z.object({id:z.string(),label:z.string(),value:z.union([z.string(),z.number(),z.boolean()]),source:z.enum(["user","fixture","system_default"]),editable:z.boolean()})),
 evidence:z.array(z.object({type:z.enum(["account","transaction","bill","income","goal","forecast"]),label:z.string(),value:z.union([MoneySchema,z.string(),z.number()]),asOf:z.string()})),
 dataSufficiency:z.object({status:z.enum(["sufficient","partial","insufficient"]),coverage:z.number().min(0).max(1),missing:z.array(z.string())}),
 conflicts:z.array(z.string()),minimumNecessaryChange:z.string().nullable(),updatedAt:z.string(),
});
export type GoalFeasibility=z.infer<typeof GoalFeasibilitySchema>;

export const GoalImpactSignalSchema=z.object({
 id:z.string(),goalId:z.string(),signalType:z.enum(["completion_delay","safe_buffer_drop","goal_conflict","contribution_gap","data_insufficient"]),detectedAt:z.string(),
 evidence:z.array(z.object({label:z.string(),before:z.union([MoneySchema,z.string(),z.number()]),after:z.union([MoneySchema,z.string(),z.number()])})),
 estimatedImpact:z.object({completionDelayDays:z.number().int().nonnegative(),amount:MoneySchema,statusBefore:GoalFeasibilityStatusSchema,statusAfter:GoalFeasibilityStatusSchema}),
 impactRatio:z.number().min(0),urgency:z.enum(["low","medium","high"]),confidence:z.number().min(0).max(1),recommendedAction:z.object({intent:z.enum(["review","adjust_contribution","adjust_date","edit_assumptions"]),label:z.string()}),
 expiryCondition:z.string(),suppressionState:z.enum(["eligible","suppressed","dismissed","snoozed","expired"]),qualification:z.object({activeGoal:z.boolean(),thresholdExceeded:z.boolean(),actionable:z.boolean(),evidenceSufficient:z.boolean()}),
});
export type GoalImpactSignal=z.infer<typeof GoalImpactSignalSchema>;

export const NotificationPreferencesSchema=z.object({
 weeklySummaryEnabled:z.boolean().default(true),dailySummaryEnabled:z.boolean().default(false),amountThreshold:MoneySchema.default({amount:5000,currency:"CNY"}),goalImpactRatioThreshold:z.number().min(0).max(1).default(.05),quietHours:z.object({enabled:z.boolean(),start:z.string(),end:z.string(),timezone:z.string()}).default({enabled:true,start:"22:00",end:"08:00",timezone:"Asia/Shanghai"}),pausedUntil:z.string().nullable().default(null),goalOverrides:z.record(z.string(),z.object({weeklySummaryEnabled:z.boolean().optional(),amountThreshold:MoneySchema.optional(),goalImpactRatioThreshold:z.number().min(0).max(1).optional(),pausedUntil:z.string().nullable().optional()})).default({}),
});
export type NotificationPreferences=z.infer<typeof NotificationPreferencesSchema>;

export const GoalPlanStateSchema=z.enum(["draft","assessing","ready","activation_requires_confirmation","active","impact_detected","adjusting","failed"]);
export const GoalFlowStateSchema=z.object({goalId:z.string(),state:GoalPlanStateSchema,permissionLevel:z.literal("recommend"),feasibility:GoalFeasibilitySchema.nullable(),signal:GoalImpactSignalSchema.nullable(),selectedScenario:z.enum(["conservative","balanced","accelerated"]).nullable(),activatedAt:z.string().nullable(),updatedAt:z.string()});
export type GoalFlowState=z.infer<typeof GoalFlowStateSchema>;

export const GoalIntentSchema=z.object({name:z.string(),targetAmount:MoneySchema,targetDate:z.string(),monthlyContributionLimit:MoneySchema.nullable(),protectedAccountIds:z.array(z.string()),allowInvestmentSale:z.boolean().default(false),safetyBuffer:MoneySchema});
export type GoalIntent=z.infer<typeof GoalIntentSchema>;

export const GoalFlowEventSchema=z.discriminatedUnion("type",[
 z.object({type:z.literal("ASSESS"),intent:GoalIntentSchema,scenarioId:z.string()}),
 z.object({type:z.literal("SELECT_SCENARIO"),scenario:z.enum(["conservative","balanced","accelerated"])}),
 z.object({type:z.literal("REQUEST_ACTIVATION")}),
 z.object({type:z.literal("CONFIRM_ACTIVATION"),confirmed:z.literal(true)}),
 z.object({type:z.literal("APPLY_FINANCIAL_CHANGE"),amount:MoneySchema,category:z.string()}),
 z.object({type:z.literal("DISMISS_SIGNAL")}),z.object({type:z.literal("SNOOZE_SIGNAL")}),z.object({type:z.literal("START_ADJUSTMENT")}),z.object({type:z.literal("RECOVER")}),
]);
export type GoalFlowEvent=z.infer<typeof GoalFlowEventSchema>;
