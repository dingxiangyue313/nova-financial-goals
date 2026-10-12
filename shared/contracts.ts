import { z } from 'zod';

export const MoneySchema = z.number().int().nonnegative();
export const IsoDateSchema = z.iso.date();

export const GoalSchema = z.object({
  id: z.string().min(1), title: z.string().min(1).max(60),
  targetCents: MoneySchema, savedCents: MoneySchema, targetDate: IsoDateSchema,
  originalDate: IsoDateSchema, monthlyContributionCents: MoneySchema,
  protectedCents: MoneySchema, flexibilityWeeks: z.number().int().min(0).max(52),
  status: z.enum(['draft', 'active', 'paused', 'achieved']),
  selectedPlanId: z.string().nullable(), imageUrl: z.string(), quote: z.string(),
});
export type Goal = z.infer<typeof GoalSchema>;

export const FinanceSchema = z.object({
  checkingCents: MoneySchema, emergencyCents: MoneySchema,
  monthlyIncomeCents: MoneySchema, fixedBillsCents: MoneySchema,
  essentialSpendingCents: MoneySchema, currentMonthExpenseCents: MoneySchema,
  historyMonths: z.number().int().min(0), updatedAt: IsoDateSchema,
});
export type Finance = z.infer<typeof FinanceSchema>;

export const AccountSchema = z.object({
  id: z.string(), label: z.string(), type: z.enum(['checking', 'emergency', 'goal', 'investment']),
  balanceCents: MoneySchema, currency: z.string().length(3).default('CNY'), protected: z.boolean().default(false),
});
export type Account = z.infer<typeof AccountSchema>;

export const TransactionSchema = z.object({
  id: z.string(), accountId: z.string(), date: IsoDateSchema, title: z.string(),
  category: z.string(), amountCents: z.number().int(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const BillSchema = z.object({
  id: z.string(), title: z.string(), dueDate: IsoDateSchema, amountCents: MoneySchema, paid: z.boolean(),
});
export type Bill = z.infer<typeof BillSchema>;

export const SubscriptionSchema = z.object({
  id: z.string(), title: z.string(), monthlyCents: MoneySchema, nextChargeDate: IsoDateSchema,
  status: z.enum(['active', 'cancelled']),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const ImpactSchema = z.object({
  id: z.string(), title: z.string(), expenseCents: MoneySchema,
  detectedAt: IsoDateSchema, shortfallCents: MoneySchema,
  delayDays: z.number().int().nonnegative(),
  optionAContributionCents: MoneySchema, optionAAvailable: z.boolean().default(true), optionBDate: IsoDateSchema,
  dismissed: z.boolean().default(false),
});
export type Impact = z.infer<typeof ImpactSchema>;

export const MandateSchema = z.object({
  id: z.string(), goalId: z.string(), category: z.string(),
  maxPerOperationCents: MoneySchema, totalLimitCents: MoneySchema,
  spentCents: MoneySchema, expiresAt: IsoDateSchema, active: z.boolean(),
});
export type Mandate = z.infer<typeof MandateSchema>;

export const AuditSchema = z.object({
  id: z.string(), at: z.string(), action: z.string(), outcome: z.string(),
  detail: z.string(), operationId: z.string().optional(), requestId: z.string().optional(),
  approvalId: z.string().optional(), twinVersion: z.number().int().positive().optional(),
  sequence: z.number().int().positive().optional(), previousHash: z.string().optional(), eventHash: z.string().optional(),
});
export type Audit = z.infer<typeof AuditSchema>;

export const ApprovalSchema = z.object({
  id: z.string(), action: z.string(), parameters: z.record(z.string(), z.unknown()),
  twinVersion: z.number().int().positive(), snapshotHash: z.string(), expiresAt: z.string(),
  status: z.enum(['pending', 'confirmed', 'consumed', 'expired']), token: z.string().nullable().default(null),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const ReceiptSchema = z.object({
  operationId: z.string(), tool: z.string(), status: z.enum(['succeeded', 'failed', 'unknown']),
  amountCents: MoneySchema.optional(), currency: z.string().length(3).default('CNY'),
  executedAt: z.string(), twinVersion: z.number().int().positive(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export const OperationSchema = z.object({
  operationId: z.string(), idempotencyKey: z.string(),
  status: z.enum(['executed', 'ask', 'blocked', 'unknown']),
  category: z.string(), amountCents: MoneySchema, reason: z.string(),
  agentId: z.string().optional(), mandateId: z.string().nullable().optional(),
  tool: z.string().default('external_payment'), inputHash: z.string().optional(),
  receipt: ReceiptSchema.nullable().default(null),
});
export type Operation = z.infer<typeof OperationSchema>;

export const FinancialTwinSchema = z.object({
  snapshotId: z.string(), version: z.number().int().positive(), asOf: IsoDateSchema,
  accounts: z.array(AccountSchema), transactions: z.array(TransactionSchema), bills: z.array(BillSchema),
  subscriptions: z.array(SubscriptionSchema), goals: z.array(GoalSchema), mandates: z.array(MandateSchema),
  safetyBufferCents: MoneySchema,
});
export type FinancialTwin = z.infer<typeof FinancialTwinSchema>;

export const DemoStateSchema = z.object({
  clock: IsoDateSchema, goal: GoalSchema, finance: FinanceSchema,
  pendingImpact: ImpactSchema.nullable(), mandate: MandateSchema.nullable(),
  audit: z.array(AuditSchema), operations: z.array(OperationSchema),
  twinVersion: z.number().int().positive().default(1),
  accounts: z.array(AccountSchema).default([]), transactions: z.array(TransactionSchema).default([]),
  bills: z.array(BillSchema).default([]), subscriptions: z.array(SubscriptionSchema).default([]),
  approvals: z.array(ApprovalSchema).default([]), receipts: z.array(ReceiptSchema).default([]),
  consumedNonces: z.array(z.string()).default([]),
});
export type DemoState = z.infer<typeof DemoStateSchema>;

export const PlanSchema = z.object({
  id: z.string(), label: z.string(), monthlyCents: MoneySchema,
  projectedDate: IsoDateSchema.nullable(), safeToSpendCents: z.number().int(),
  status: z.enum(['on_track', 'at_risk', 'infeasible']),
  explanation: z.string(), recommended: z.boolean(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const AssessmentSchema = z.object({
  status: z.enum(['insufficient_data', 'on_track', 'at_risk', 'infeasible']),
  progressPercent: z.number().min(0).max(100),
  requiredMonthlyCents: MoneySchema, availableMonthlyCents: MoneySchema,
  projectedDate: IsoDateSchema.nullable(), delayDays: z.number().int().nonnegative(),
  safeToSpendCents: z.number().int(), dataSufficiency: z.string(),
  assumptions: z.array(z.string()), plans: z.array(PlanSchema).max(3),
  updatedAt: IsoDateSchema,
});
export type Assessment = z.infer<typeof AssessmentSchema>;

export const UiCardSchema = z.object({
  id: z.string(), type: z.enum(['goal_progress_card','goal_feasibility_card','goal_impact_signal','scenario_compare','approval_sheet','execution_receipt','error_recovery']),
  title: z.string(), body: z.string(), tone: z.enum(['neutral','good','warning','danger']),
  action: z.object({ id: z.string(), label: z.string() }).nullable(),
});
export type UiCard = z.infer<typeof UiCardSchema>;

export const SnapshotSchema = z.object({
  goal: GoalSchema, finance: FinanceSchema, assessment: AssessmentSchema,
  pendingImpact: ImpactSchema.nullable(), mandate: MandateSchema.nullable(),
  audit: z.array(AuditSchema), operations: z.array(OperationSchema),
  cards: z.array(UiCardSchema), clock: IsoDateSchema,
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
