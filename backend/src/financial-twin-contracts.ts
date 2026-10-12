import { z } from "zod";

const MoneyAmount=z.number().int();
export const TwinAccountSchema=z.object({id:z.string(),name:z.string(),type:z.enum(["checking","savings","goal","investment"]),balance:MoneyAmount,protected:z.boolean()});
export const TwinCashflowSchema=z.object({id:z.string(),date:z.string(),label:z.string(),category:z.string(),amount:MoneyAmount,recurring:z.boolean().default(false),source:z.enum(["fixture","user","tool"])});
export const TwinGoalSchema=z.object({id:z.string(),name:z.string(),targetAmount:z.number().int().nonnegative(),savedAmount:z.number().int().nonnegative(),targetDate:z.string(),monthlyContribution:z.number().int().nonnegative(),priority:z.number().int(),status:z.enum(["draft","active","paused","completed"]),selectedPlan:z.enum(["conservative","balanced","accelerated"]).nullable().default(null)});
export const TwinActivitySchema=z.object({id:z.string(),type:z.enum(["suggestion","approval","execution","failure","state_change"]),title:z.string(),status:z.enum(["succeeded","pending","failed","cancelled","unknown"]),amount:MoneyAmount.optional(),operationId:z.string().optional(),createdAt:z.string(),details:z.string()});
export const FinancialTwinStateSchema=z.object({
  id:z.string(),version:z.number().int().positive(),currency:z.literal("CNY"),updatedAt:z.string(),
  safetyBuffer:z.number().int().nonnegative(),accounts:z.array(TwinAccountSchema),cashflows:z.array(TwinCashflowSchema),goals:z.array(TwinGoalSchema),
  mandate:z.object({id:z.string(),version:z.number().int().positive(),status:z.enum(["active","paused","revoked"]),perTransactionLimit:z.number().int().nonnegative(),dailyLimit:z.number().int().nonnegative(),remainingLimit:z.number().int().nonnegative()}),
  selectedPlan:z.enum(["conservative","balanced","accelerated"]).nullable(),activities:z.array(TwinActivitySchema).max(100),
});
export type FinancialTwinState=z.infer<typeof FinancialTwinStateSchema>;

export const TwinActionSchema=z.discriminatedUnion("type",[
  z.object({type:z.literal("simulate_expense"),amount:z.number().int().nonnegative(),date:z.string().optional(),goalId:z.string().optional(),strategy:z.enum(["adjust_contribution","adjust_date"]).default("adjust_contribution")}),
  z.object({type:z.literal("record_expense"),amount:z.number().int().positive(),category:z.string(),merchant:z.string(),operationId:z.string().optional()}),
  z.object({type:z.literal("record_transfer"),amount:z.number().int().positive(),sourceAccountId:z.string(),destinationAccountId:z.string(),operationId:z.string().optional()}),
  z.object({type:z.literal("select_goal_plan"),goalId:z.string(),plan:z.enum(["conservative","balanced","accelerated"])}),
  z.object({type:z.literal("activate_goal"),goalId:z.string()}),
  z.object({type:z.literal("create_goal"),goal:z.object({id:z.string(),name:z.string(),targetAmount:z.number().int().nonnegative(),savedAmount:z.number().int().nonnegative().default(0),targetDate:z.string(),monthlyContribution:z.number().int().nonnegative().default(0),priority:z.number().int().nonnegative().default(3),status:z.enum(["draft","active","paused","completed"]).default("active")})}),
  z.object({type:z.literal("update_goal"),goalId:z.string(),changes:z.object({targetAmount:z.number().int().nonnegative().optional(),targetDate:z.string().optional(),monthlyContribution:z.number().int().nonnegative().optional(),protectedEmergencyFund:z.boolean().optional(),avoidSellingInvestments:z.boolean().optional()})}),
  z.object({type:z.literal("resolve_shopping"),decision:z.enum(["approved","rejected"]),amount:z.number().int().positive().default(28000),merchant:z.string().default("Shibuya Loft")}),
  z.object({type:z.literal("update_mandate"),id:z.string().optional(),status:z.enum(["active","paused","revoked"]),perTransactionLimit:z.number().int().nonnegative(),dailyLimit:z.number().int().nonnegative(),remainingLimit:z.number().int().nonnegative()}),
]);
export type TwinAction=z.infer<typeof TwinActionSchema>;
