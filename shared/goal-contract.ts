import {z} from 'zod';
const cents=z.number().int().nonnegative().max(100000000);
export const GoalContractTermsSchema=z.object({
 goalId:z.string().min(1),title:z.string().trim().min(1).max(60),targetCents:cents.positive(),targetDate:z.iso.date(),
 monthlyContributionCents:cents,protectedCents:cents,priority:z.number().int().min(1).max(5),
 maxMonthlyIncreaseCents:cents,maxExtensionDays:z.number().int().min(0).max(365),allowPayments:z.boolean(),
}).strict();
export const GoalContractSchema=GoalContractTermsSchema.extend({revision:z.number().int().nonnegative(),updatedAt:z.string(),
 requiredChecks:z.array(z.enum(['funds','card','mandate','orders'])),protectedAccountIds:z.array(z.string()),
});
export type GoalContract=z.infer<typeof GoalContractSchema>;
export const GoalContractChangeSchema=GoalContractTermsSchema.extend({expectedRevision:z.number().int().nonnegative()}).strict();
