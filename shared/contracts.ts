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

export const RiskPreferencesSchema = z.object({
  amountThresholdCents: MoneySchema.default(50000),
  goalImpactRatioThresholdBps: z.number().int().min(0).max(10000).default(500),
  weeklySummaryEnabled: z.boolean().default(true),
  quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().default(null),
  pausedUntil: IsoDateSchema.nullable().default(null),
  goalOverrides: z.record(z.string(), z.object({
    amountThresholdCents: MoneySchema.optional(),
    goalImpactRatioThresholdBps: z.number().int().min(0).max(10000).optional(),
  })).default({}),
});
export type RiskPreferences = z.infer<typeof RiskPreferencesSchema>;
export const RiskPreferencesPatchSchema = z.object({
  amountThresholdCents: MoneySchema.optional(),
  goalImpactRatioThresholdBps: z.number().int().min(0).max(10000).optional(),
  weeklySummaryEnabled: z.boolean().optional(),
  quietHours: z.object({ start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable().optional(),
  pausedUntil: IsoDateSchema.nullable().optional(),
  goalOverrides: z.record(z.string(), z.object({
    amountThresholdCents: MoneySchema.optional(),
    goalImpactRatioThresholdBps: z.number().int().min(0).max(10000).optional(),
  })).optional(),
});
export type RiskPreferencesPatch = z.infer<typeof RiskPreferencesPatchSchema>;

export const SpendingPatternSchema = z.object({
  id: z.string(), category: z.string(), label: z.string(),
  periodStart: IsoDateSchema, periodEnd: IsoDateSchema,
  baselineCents: MoneySchema, currentCents: MoneySchema, increaseCents: MoneySchema,
  increaseRatioBps: z.number().int().nonnegative(), transactionCount: z.number().int().nonnegative(),
  evidenceTransactionIds: z.array(z.string()), categoryConfidence: z.number().min(0).max(1),
  confidence: z.enum(['low', 'medium', 'high']), meetsTrendEvidence: z.boolean(),
});
export type SpendingPattern = z.infer<typeof SpendingPatternSchema>;

export const GoalRiskImpactSchema = z.object({
  beforeStatus: z.enum(['insufficient_data', 'on_track', 'at_risk', 'infeasible']),
  afterStatus: z.enum(['insufficient_data', 'on_track', 'at_risk', 'infeasible']),
  beforeProjectedDate: IsoDateSchema.nullable(), afterProjectedDate: IsoDateSchema.nullable(),
  delayDays: z.number().int().nonnegative(), shortfallCents: MoneySchema,
  safetyBufferAffected: z.boolean(),
});
export type GoalRiskImpact = z.infer<typeof GoalRiskImpactSchema>;

export const RiskDecisionSchema = z.object({
  scope: z.enum(['consumer', 'agent']),
  outcome: z.enum(['silent', 'weekly_summary', 'immediate_signal', 'execute', 'ask', 'manual_review', 'block']),
  reasonCode: z.string(), explanation: z.string(),
  twinVersion: z.number().int().positive(), ruleVersion: z.string(),
  patternId: z.string().nullable().default(null), goalImpact: GoalRiskImpactSchema.nullable().default(null),
  suppressed: z.boolean().default(false),
});
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const GoalImpactSignalSchema = z.object({
  id: z.string(), goalId: z.string(), patternId: z.string(), impactId: z.string(), createdAt: IsoDateSchema,
  title: z.string(), decision: z.literal('immediate_signal'),
  evidence: z.array(z.object({ transactionId: z.string(), date: IsoDateSchema, amountCents: MoneySchema })),
  confidence: z.enum(['low', 'medium', 'high']), ruleVersion: z.string(),
  twinVersion: z.number().int().positive(), impact: GoalRiskImpactSchema,
  status: z.enum(['active', 'later', 'dismissed', 'resolved']),
  suppressionKey: z.string(),
});
export type GoalImpactSignal = z.infer<typeof GoalImpactSignalSchema>;

export const NotificationDeliverySchema = z.object({
  mode: z.enum(['summary', 'immediate', 'deferred', 'suppressed']),
  availableAt: z.string(),
  urgent: z.boolean(),
});
export type NotificationDelivery = z.infer<typeof NotificationDeliverySchema>;

export const WeeklyRiskSummarySchema = z.object({
  id: z.string().min(1), goalId: z.string().min(1),
  weekStart: IsoDateSchema, weekEnd: IsoDateSchema,
  patternIds: z.array(z.string()), outcome: z.enum(['stable', 'watch']),
  title: z.string(), body: z.string(),
  twinVersion: z.number().int().positive(), ruleVersion: z.string(),
  status: z.enum(['available', 'read', 'dismissed']),
  dedupeKey: z.string().min(1), createdAt: z.string(),
  delivery: NotificationDeliverySchema,
});
export type WeeklyRiskSummary = z.infer<typeof WeeklyRiskSummarySchema>;

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
  version: z.number().int().positive().default(1), agentId: z.string().default('travel-agent-demo'),
  validFrom: IsoDateSchema.default('2026-09-21'),
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

export const ToolRecordSchema = z.object({
  id: z.string(), kind: z.enum(['transfer_draft', 'fx_quote', 'fx_draft']),
  status: z.enum(['prepared', 'active', 'consumed', 'expired']),
  data: z.record(z.string(), z.unknown()), expiresAt: z.string().nullable().default(null),
});
export type ToolRecord = z.infer<typeof ToolRecordSchema>;

export const OperationSchema = z.object({
  operationId: z.string(), idempotencyKey: z.string(),
  status: z.enum(['executed', 'ask', 'blocked', 'manual_review', 'unknown']),
  originalDecision: z.enum(['execute', 'ask', 'block', 'manual_review', 'unknown']).optional(),
  category: z.string(), amountCents: MoneySchema, reason: z.string(),
  agentId: z.string().optional(), mandateId: z.string().nullable().optional(),
  tool: z.string().default('external_payment'), inputHash: z.string().optional(),
  createdAt: z.string().optional(),
  verificationRequirement: z.enum(['none', 'quick_confirm', 'platform']).default('none'),
  verificationStatus: z.enum(['not_required', 'pending', 'verified', 'failed']).default('not_required'),
  balanceBeforeCents: MoneySchema.optional(), balanceAfterCents: MoneySchema.nullable().optional(),
  mandateSpentBeforeCents: MoneySchema.nullable().optional(), mandateSpentAfterCents: MoneySchema.nullable().optional(),
  twinVersionBefore: z.number().int().positive().optional(), twinVersionAfter: z.number().int().positive().nullable().optional(),
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
  consumedNonces: z.array(z.string()).default([]), toolRecords: z.array(ToolRecordSchema).default([]),
  riskPreferences: RiskPreferencesSchema.default({
    amountThresholdCents: 50000, goalImpactRatioThresholdBps: 500,
    weeklySummaryEnabled: true, quietHours: null, pausedUntil: null, goalOverrides: {},
  }),
  spendingPatterns: z.array(SpendingPatternSchema).default([]),
  riskSignals: z.array(GoalImpactSignalSchema).default([]),
  weeklyRiskSummaries: z.array(WeeklyRiskSummarySchema).default([]),
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

export const GoalAssumptionsSchema = z.object({
  targetCents: MoneySchema.positive(),
  targetDate: IsoDateSchema,
  monthlyContributionCents: MoneySchema,
  protectedCents: MoneySchema,
  flexibilityWeeks: z.number().int().min(0).max(52),
});
export type GoalAssumptions = z.infer<typeof GoalAssumptionsSchema>;

export const PlanStepSchema = z.object({
  id: z.enum(['goal_details', 'assumptions', 'plan_selection', 'activation']),
  label: z.string(),
  status: z.enum(['complete', 'current', 'pending']),
  detail: z.string(),
});
export type PlanStep = z.infer<typeof PlanStepSchema>;

export const GoalScenarioPreviewSchema = z.object({
  id: z.string().min(1), goalId: z.string().min(1),
  baseTwinVersion: z.number().int().positive(), generatedAt: IsoDateSchema,
  assumptions: GoalAssumptionsSchema,
  assessment: AssessmentSchema,
  plans: z.array(PlanSchema).max(3),
  steps: z.array(PlanStepSchema).length(4),
  impact: z.object({
    protectedFundsSafe: z.boolean(),
    safeToSpendCents: z.number().int(),
    projectedDate: IsoDateSchema.nullable(),
    delayDays: z.number().int().nonnegative(),
  }),
});
export type GoalScenarioPreview = z.infer<typeof GoalScenarioPreviewSchema>;

export const UiCardSchema = z.object({
  id: z.string(), type: z.enum(['goal_input','goal_progress_card','goal_feasibility_card','assumption_editor','scenario_compare','goal_impact_signal','approval_sheet','risk_disclosure','execution_receipt','error_recovery','explanation']),
  title: z.string(), body: z.string(), tone: z.enum(['neutral','good','warning','danger']),
  action: z.object({ id: z.string(), label: z.string() }).nullable(),
});
export type UiCard = z.infer<typeof UiCardSchema>;

export const AgentIntentSchema = z.enum([
  'goal_planning', 'goal_status', 'goal_impact', 'mandate_management',
  'external_agent_request', 'clarification', 'rejected_prompt_injection',
]);
export type AgentIntent = z.infer<typeof AgentIntentSchema>;

const AgentComponentBase = z.object({ id: z.string().min(1) });
const AgentToneSchema = z.enum(['neutral', 'good', 'warning', 'danger']);
export const AgentComponentSchema = z.discriminatedUnion('type', [
  AgentComponentBase.extend({ type: z.literal('explanation'), title: z.string(), body: z.string(), tone: AgentToneSchema }),
  AgentComponentBase.extend({ type: z.literal('goal_summary'), title: z.string(), goal: GoalSchema.pick({
    title: true, targetCents: true, savedCents: true, targetDate: true, protectedCents: true, status: true,
  }) }),
  AgentComponentBase.extend({ type: z.literal('feasibility'), title: z.string(), assessment: AssessmentSchema }),
  AgentComponentBase.extend({ type: z.literal('plan_compare'), title: z.string(), plans: z.array(PlanSchema).min(1).max(3) }),
  AgentComponentBase.extend({ type: z.literal('impact_summary'), title: z.string(), impact: ImpactSchema,
    protectedCents: MoneySchema }),
  AgentComponentBase.extend({ type: z.literal('risk_signal'), title: z.string(),
    signal: GoalImpactSignalSchema, pattern: SpendingPatternSchema, protectedCents: MoneySchema }),
  AgentComponentBase.extend({ type: z.literal('mandate_preview'), title: z.string(), mandate: z.object({
    agentId: z.string(), category: z.string(), maxPerOperationCents: MoneySchema,
    totalLimitCents: MoneySchema, expiresAt: IsoDateSchema, active: z.boolean(),
  }) }),
  AgentComponentBase.extend({ type: z.literal('confirmation'), title: z.string(), body: z.string(), tone: AgentToneSchema,
    action: z.object({ actionId: z.string().min(10), label: z.string(), destructive: z.boolean().default(false) }) }),
  AgentComponentBase.extend({ type: z.literal('receipt'), title: z.string(), body: z.string(),
    status: z.enum(['succeeded', 'failed', 'unknown']), operationId: z.string().optional() }),
  AgentComponentBase.extend({ type: z.literal('audit_summary'), title: z.string(), body: z.string(), chainValid: z.boolean() }),
  AgentComponentBase.extend({ type: z.literal('clarification'), title: z.string(), body: z.string(), suggestions: z.array(z.string()).max(4) }),
  AgentComponentBase.extend({ type: z.literal('error_recovery'), title: z.string(), body: z.string(), code: z.string() }),
  AgentComponentBase.extend({ type: z.literal('goal_input_card'), title: z.string(), goal: GoalSchema.pick({
    title: true, targetCents: true, savedCents: true, targetDate: true, protectedCents: true, status: true,
  }), draftId: z.string().optional() }),
  AgentComponentBase.extend({ type: z.literal('goal_feasibility_card'), title: z.string(), assessment: AssessmentSchema }),
  AgentComponentBase.extend({ type: z.literal('goal_progress_card'), title: z.string(), goal: GoalSchema,
    progressPercent: z.number().min(0).max(100) }),
  AgentComponentBase.extend({ type: z.literal('assumption_editor'), title: z.string(),
    assumptions: GoalAssumptionsSchema, baseTwinVersion: z.number().int().positive() }),
  AgentComponentBase.extend({ type: z.literal('what_if_simulator'), title: z.string(),
    assumptions: GoalAssumptionsSchema, baseTwinVersion: z.number().int().positive() }),
  AgentComponentBase.extend({ type: z.literal('scenario_compare'), title: z.string(), plans: z.array(PlanSchema).min(1).max(3) }),
  AgentComponentBase.extend({ type: z.literal('plan_steps'), title: z.string(), steps: z.array(PlanStepSchema) }),
  AgentComponentBase.extend({ type: z.literal('goal_impact_brief'), title: z.string(), body: z.string(),
    summary: WeeklyRiskSummarySchema.optional(), signal: GoalImpactSignalSchema.optional() }),
  AgentComponentBase.extend({ type: z.literal('notification_preference_card'), title: z.string(),
    preferences: RiskPreferencesSchema, goalId: z.string() }),
]);
export type AgentComponent = z.infer<typeof AgentComponentSchema>;

export const AgentThreadSchema = z.object({
  id: z.string(), title: z.string().min(1).max(80), kind: z.enum(['task', 'risk', 'summary']),
  status: z.enum(['active', 'archived']), unread: z.boolean(), readOnly: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(),
});
export type AgentThread = z.infer<typeof AgentThreadSchema>;

export const AgentMessageSchema = z.object({
  id: z.string(), threadId: z.string(), role: z.enum(['user', 'assistant', 'system']),
  content: z.string(), components: z.array(AgentComponentSchema), createdAt: z.string(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentTurnSchema = z.object({
  id: z.string(), thread: AgentThreadSchema, intent: AgentIntentSchema,
  provider: z.enum(['deepseek', 'deterministic']), fallbackReason: z.string().nullable(),
  twinVersion: z.number().int().positive(), message: AgentMessageSchema,
  components: z.array(AgentComponentSchema), suggestedPrompts: z.array(z.string()).max(4),
  canvasComponents: z.array(AgentComponentSchema).default([]),
});
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export const SnapshotSchema = z.object({
  goal: GoalSchema, finance: FinanceSchema, assessment: AssessmentSchema,
  pendingImpact: ImpactSchema.nullable(), mandate: MandateSchema.nullable(),
  audit: z.array(AuditSchema), operations: z.array(OperationSchema),
  receipts: z.array(ReceiptSchema), approvalSummaries: z.array(ApprovalSchema.omit({ token: true })),
  auditChainValid: z.boolean(), twinVersion: z.number().int().positive(),
  cards: z.array(UiCardSchema), clock: IsoDateSchema,
  riskPreferences: RiskPreferencesSchema,
  spendingPatterns: z.array(SpendingPatternSchema),
  riskSignals: z.array(GoalImpactSignalSchema),
  weeklyRiskSummaries: z.array(WeeklyRiskSummarySchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
