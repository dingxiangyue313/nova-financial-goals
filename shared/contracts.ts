import { SkillIdSchema, MissionSkillResultSchema, MoneyMissionReadModelSchema, AccountSnapshotSchema, StatementImportBatchSchema, ImportIssueSchema, NormalizedStatementRowSchema, EvidenceRefSchema, BillBriefSchema, SubscriptionActionSchema, DatedCashflowForecastSchema, GoalPlanOptionSchema, TransferScheduleSchema, TransferExecutionSchema, HandoffCasePackSchema } from './money-mission.ts';
export * from './money-mission.ts';
import { MissionSchema } from './mission.ts';
import { z } from 'zod';

export const MoneySchema = z.number().int().nonnegative();
export const IsoDateSchema = z.iso.date();

export const DataSourceKindSchema = z.enum(['bank', 'wechat_pay', 'alipay']);
export type DataSourceKind = z.infer<typeof DataSourceKindSchema>;

export const DataPermissionScopeSchema = z.enum(['balances', 'transactions_90_days']);
export type DataPermissionScope = z.infer<typeof DataPermissionScopeSchema>;

export const DataProvenanceSchema = z.enum(['connected_data', 'system_calculated', 'user_assumption', 'uploaded_statement']);
export type DataProvenance = z.infer<typeof DataProvenanceSchema>;

export const DataConnectionSchema = z.object({
  id: z.string().min(1), source: DataSourceKindSchema, label: z.string().min(1),
  status: z.enum(['connected', 'revoked', 'error']), simulated: z.literal(true),
  permissionScopes: z.array(DataPermissionScopeSchema).min(1),
  connectedAt: z.string(), revokedAt: z.string().nullable().default(null),
  lastSyncedAt: z.string().nullable().default(null),
  lastAttemptAt: z.string().nullable().default(null),
  coverageStart: IsoDateSchema.nullable().default(null), coverageEnd: IsoDateSchema.nullable().default(null),
  errorCode: z.string().nullable().default(null), errorMessage: z.string().nullable().default(null),
  consecutiveFailures: z.number().int().nonnegative().default(0),
});
export type DataConnection = z.infer<typeof DataConnectionSchema>;

export const DataSyncBatchSchema = z.object({
  id: z.string().min(1), dedupeKey: z.string().min(1),
  kind: z.enum(['historical', 'weekly_trend', 'goal_risk']),
  sources: z.array(DataSourceKindSchema).min(1), status: z.literal('completed'),
  importedCount: z.number().int().nonnegative(), completedAt: z.string(),
  twinVersionBefore: z.number().int().positive(), twinVersionAfter: z.number().int().positive(),
});
export type DataSyncBatch = z.infer<typeof DataSyncBatchSchema>;

export const DataSyncResultSchema = z.object({
  importedCount: z.number().int().nonnegative(), replayed: z.boolean(),
  status: z.enum(['completed', 'partial', 'failed', 'unchanged']),
  sources: z.array(z.object({
    source: DataSourceKindSchema,
    status: z.enum(['synced', 'unchanged', 'failed', 'skipped']),
    importedCount: z.number().int().nonnegative(),
    errorCode: z.string().nullable().default(null),
  })),
  batchKinds: z.array(DataSyncBatchSchema.shape.kind),
  coverageStart: IsoDateSchema.nullable(), coverageEnd: IsoDateSchema.nullable(),
  twinVersion: z.number().int().positive(),
});
export type DataSyncResult = z.infer<typeof DataSyncResultSchema>;

export const GoalSchema = z.object({
  id: z.string().min(1), title: z.string().min(1).max(60),
  targetCents: MoneySchema, savedCents: MoneySchema, targetDate: IsoDateSchema,
  originalDate: IsoDateSchema, monthlyContributionCents: MoneySchema,
  firstMonthContributionCents: MoneySchema.optional(),
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
  goalId: z.string().optional(),
  id: z.string(), label: z.string(), type: z.enum(['checking', 'emergency', 'goal', 'investment']),
  balanceCents: MoneySchema, currency: z.string().length(3).default('CNY'), protected: z.boolean().default(false),
});
export type Account = z.infer<typeof AccountSchema>;

export const TransactionSchema = z.object({
  id: z.string(), accountId: z.string(), date: IsoDateSchema, title: z.string(),
  category: z.string(), amountCents: z.number().int(),
  sourceKind: DataSourceKindSchema.optional(), provenance: DataProvenanceSchema.optional(),
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
  evidence: z.array(z.object({ transactionId: z.string(), date: IsoDateSchema, amountCents: MoneySchema,
    sourceKind: DataSourceKindSchema.optional() })),
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
  recurrence: z.enum(['monthly','one_time']).optional(),
  id: z.string(), title: z.string(), dueDate: IsoDateSchema, amountCents: MoneySchema, paid: z.boolean(),
});
export type Bill = z.infer<typeof BillSchema>;

export const SubscriptionSchema = z.object({
  cadence: z.enum(['monthly','annual']).optional(),
  id: z.string(), title: z.string(), monthlyCents: MoneySchema, nextChargeDate: IsoDateSchema,
  status: z.enum(['active', 'cancelled']),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

export const ImpactSchema = z.object({
  id: z.string(), goalId: z.string().nullable().default(null), title: z.string(), expenseCents: MoneySchema,
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
  accountSnapshots: z.array(AccountSnapshotSchema).default([]),
  statementImportBatches: z.array(StatementImportBatchSchema).default([]),
  importIssues: z.array(ImportIssueSchema).default([]),
  normalizedStatementRows: z.array(NormalizedStatementRowSchema).default([]),
  evidenceRefs: z.array(EvidenceRefSchema).default([]),
  billBriefs: z.array(BillBriefSchema).default([]),
  subscriptionActions: z.array(SubscriptionActionSchema).default([]),
  datedForecasts: z.array(DatedCashflowForecastSchema).default([]),
  goalPlanOptions: z.array(GoalPlanOptionSchema).default([]),
  transferSchedules: z.array(TransferScheduleSchema).default([]),
  transferExecutions: z.array(TransferExecutionSchema).default([]),
  handoffCasePacks: z.array(HandoffCasePackSchema).default([]),
  mission: MissionSchema.optional(),
  clock: IsoDateSchema, goal: GoalSchema, finance: FinanceSchema,
  goals: z.array(GoalSchema).default([]), primaryGoalId: z.string().nullable().default(null),
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
  dataConnections: z.array(DataConnectionSchema).default([]),
  dataSyncBatches: z.array(DataSyncBatchSchema).default([]),
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

export const GoalFieldSourceSchema = z.enum(['user_provided', 'connected_data', 'system_calculated', 'default_assumption']);
export type GoalFieldSource = z.infer<typeof GoalFieldSourceSchema>;
export const GoalDraftSchema = z.object({
  id: z.string().min(1), threadId: z.string().min(1), goalId: z.string().nullable().default(null),
  title: z.string().min(1).max(60).nullable().default(null),
  targetCents: MoneySchema.positive().nullable().default(null),
  targetDate: IsoDateSchema.nullable().default(null),
  savedCents: MoneySchema.nullable().default(null),
  monthlyContributionCapCents: MoneySchema.nullable().default(null),
  protectedCents: MoneySchema.nullable().default(null),
  flexibilityWeeks: z.number().int().min(0).max(52).nullable().default(null),
  fieldSources: z.record(z.string(), GoalFieldSourceSchema).default({}),
  missingRequiredFields: z.array(z.enum(['title', 'targetCents', 'targetDate'])),
  updatedAt: z.string(),
});
export type GoalDraft = z.infer<typeof GoalDraftSchema>;

export const AgentTaskPhaseSchema = z.enum([
  'understanding', 'investigating', 'simulating', 'awaiting_user',
  'awaiting_confirmation', 'verifying', 'monitoring', 'paused', 'completed', 'failed',
]);
export type AgentTaskPhase = z.infer<typeof AgentTaskPhaseSchema>;
export const AgentTaskSourceSchema = z.object({
  kind: z.enum(['user_message', 'connected_data', 'system_calculated', 'default_assumption']),
  messageId: z.string().min(1).nullable(),
  confirmation: z.enum(['unconfirmed', 'user_confirmed', 'system_verified']),
});
export const AgentTaskFactsSchema = z.object({
  title: z.string().min(1).max(60).nullable(),
  targetCents: MoneySchema.positive().nullable(),
  originalTargetDate: IsoDateSchema.nullable(),
  savedCents: MoneySchema.nullable(),
});
export const AgentTaskConstraintsSchema = z.object({
  latestAllowedDate: IsoDateSchema.nullable(),
  monthlyContributionCapCents: MoneySchema.nullable(),
  protectedCents: MoneySchema.nullable(),
  preserveEssentialSpending: z.boolean().nullable(),
});
export const AgentTaskPreferenceSchema = z.object({
  key: z.string().min(1).max(80), value: z.string().max(240), source: AgentTaskSourceSchema,
});
export const AgentTaskRunRecordSchema = z.object({
  id: z.string().min(1), kind: z.enum(['started', 'tool_completed', 'tool_failed', 'waiting', 'resumed', 'stopped']),
  summary: z.string().min(1).max(240), at: z.string().datetime({ offset: true }),
  toolResultId: z.string().min(1).nullable(),
});
export const AgentTaskSchema = z.object({
  taskId: z.string().uuid(), threadId: z.string().min(1), demoRunId: z.string().uuid(),
  goalDraftId: z.string().min(1).nullable(), goalId: z.string().min(1).nullable(),
  phase: AgentTaskPhaseSchema,
  waitingReason: z.enum(['missing_information', 'user_choice', 'approval', 'user_paused', 'thread_archived']).nullable(),
  taskRevision: z.number().int().nonnegative(), baseTwinVersion: z.number().int().positive(),
  facts: AgentTaskFactsSchema, constraints: AgentTaskConstraintsSchema,
  candidateTargetDate: IsoDateSchema.nullable(),
  fieldSources: z.record(z.string(), AgentTaskSourceSchema),
  preferences: z.array(AgentTaskPreferenceSchema).max(30),
  unknowns: z.array(z.string().min(1).max(80)).max(30),
  evidenceRefs: z.array(z.string().min(1)).max(100), candidateRefs: z.array(z.string().min(1)).max(30),
  runRecords: z.array(AgentTaskRunRecordSchema).max(100),
  pendingActionId: z.string().min(1).nullable(), nextCheck: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  terminationReason: z.enum(['cancelled', 'goal_completed', 'applied', 'failed', 'demo_reset']).nullable(),
  readOnly: z.boolean(),
}).superRefine((task, context) => {
  if (task.constraints.latestAllowedDate && (!task.facts.originalTargetDate ||
    task.constraints.latestAllowedDate < task.facts.originalTargetDate))
    context.addIssue({ code: 'custom', path: ['constraints', 'latestAllowedDate'], message: 'TASK_INVALID_DATE_RANGE' });
  if (task.candidateTargetDate && (!task.facts.originalTargetDate ||
    task.candidateTargetDate > (task.constraints.latestAllowedDate ?? task.facts.originalTargetDate)))
    context.addIssue({ code: 'custom', path: ['candidateTargetDate'], message: 'TASK_CANDIDATE_DATE_OUT_OF_RANGE' });
  const waiting = task.phase === 'awaiting_user' || task.phase === 'awaiting_confirmation' || task.phase === 'paused';
  if (waiting !== (task.waitingReason !== null))
    context.addIssue({ code: 'custom', path: ['waitingReason'], message: 'TASK_WAITING_REASON_MISMATCH' });
  if (task.phase === 'awaiting_confirmation' && task.waitingReason !== 'approval')
    context.addIssue({ code: 'custom', path: ['waitingReason'], message: 'TASK_APPROVAL_WAIT_REQUIRED' });
  if (task.phase === 'awaiting_user' && !['missing_information', 'user_choice'].includes(task.waitingReason ?? ''))
    context.addIssue({ code: 'custom', path: ['waitingReason'], message: 'TASK_USER_WAIT_REQUIRED' });
  if (task.phase === 'paused' && !['user_paused', 'thread_archived'].includes(task.waitingReason ?? ''))
    context.addIssue({ code: 'custom', path: ['waitingReason'], message: 'TASK_PAUSE_REASON_REQUIRED' });
  if ((task.phase === 'completed' || task.phase === 'failed') !== (task.terminationReason !== null))
    context.addIssue({ code: 'custom', path: ['terminationReason'], message: 'TASK_TERMINATION_MISMATCH' });
  if (task.phase === 'failed' && task.terminationReason !== 'failed')
    context.addIssue({ code: 'custom', path: ['terminationReason'], message: 'TASK_FAILURE_REASON_REQUIRED' });
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentReadToolNameSchema = z.enum([
  'financial_overview', 'essential_bills', 'relevant_transactions', 'data_sufficiency',
  'bill_period_summary','spending_baseline_comparison','subscription_candidates','evidence_detail','dated_cashflow_forecast',
  'candidate_preview', 'search_goal_options', 'stress_test_goal_options', 'repair_stressed_goal_option',
]);
export type AgentReadToolName = z.infer<typeof AgentReadToolNameSchema>;
export const SearchGoalOptionsInputSchema = z.object({
  objective: z.enum(['lower_monthly', 'earlier', 'higher_buffer', 'balanced']).default('balanced'),
  maxResults: z.number().int().min(1).max(3).default(3),
}).strict();
export type SearchGoalOptionsInput = z.infer<typeof SearchGoalOptionsInputSchema>;
export const CandidateScenarioSchema = z.object({
  kind: z.enum(['baseline', 'current_month_expense', 'monthly_income_reduction',
    'monthly_essential_spending_increase', 'missed_contribution_once',
    'daily_salary_delay', 'fx_change', 'probability']),
  amountCents: MoneySchema.optional(),
  startMonthIndex: z.number().int().min(0).max(600).optional(),
  monthIndex: z.number().int().min(0).max(600).optional(),
}).strict();
export const CandidateInputSchema = z.object({
  targetCents: MoneySchema.positive(), targetDate: IsoDateSchema,
  monthlyContributionCents: MoneySchema,
  firstMonthContributionCents: MoneySchema.optional(),
  protectedCents: MoneySchema,
  scenario: CandidateScenarioSchema,
  evidenceResultIds: z.array(z.string().uuid()).max(10).default([]),
}).strict();
export type CandidateInput = z.infer<typeof CandidateInputSchema>;
export const CandidateAssessmentSchema = z.object({
  status: z.enum(['on_track', 'at_risk', 'infeasible', 'insufficient_data']),
  projectedDate: IsoDateSchema.nullable(), requiredMonthlyCents: MoneySchema,
  availableMonthlyCents: MoneySchema, firstMonthCapacityCents: MoneySchema,
  bufferCents: z.number().int(), fundedByTargetCents: MoneySchema,
  shortfallCents: MoneySchema, delayDays: z.number().int().nonnegative(),
  dataSufficient: z.boolean(), constraintViolations: z.array(z.string()),
}).strict();
export type CandidateAssessment = z.infer<typeof CandidateAssessmentSchema>;
export const StressScenarioSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('current_month_expense'), amountCents: MoneySchema.positive() }).strict(),
  z.object({ kind: z.literal('monthly_income_reduction'), amountCents: MoneySchema.positive(),
    startMonthIndex: z.number().int().min(0).max(600).optional() }).strict(),
  z.object({ kind: z.literal('monthly_essential_spending_increase'), amountCents: MoneySchema.positive(),
    startMonthIndex: z.number().int().min(0).max(600).optional() }).strict(),
  z.object({ kind: z.literal('missed_contribution_once'),
    monthIndex: z.number().int().min(0).max(600) }).strict(),
]);
export const StressTestGoalOptionsInputSchema = z.object({
  candidateResultIds: z.array(z.string().uuid()).min(1).max(3),
  scenarios: z.array(StressScenarioSchema).min(1).max(2),
}).strict();
export type StressTestGoalOptionsInput = z.infer<typeof StressTestGoalOptionsInputSchema>;
export const RepairStressedGoalOptionInputSchema = z.object({
  stressTestResultId: z.string().uuid(), stressResultId: z.string().uuid(),
}).strict();
export type RepairStressedGoalOptionInput = z.infer<typeof RepairStressedGoalOptionInputSchema>;
export const AgentToolSourceSchema = z.object({
  kind: z.enum(['account', 'bill', 'transaction', 'connection', 'finance', 'task', 'tool_result']),
  id: z.string().min(1),
}).strict();
export type AgentToolSource = z.infer<typeof AgentToolSourceSchema>;
const AgentToolEnvelope = z.object({
  toolResultId: z.string().uuid(), taskId: z.string().uuid(), threadId: z.string().min(1),
  demoRunId: z.string().uuid(), tool: AgentReadToolNameSchema,
  twinVersion: z.number().int().positive(), dataAsOf: IsoDateSchema,
  createdAt: z.string().datetime({ offset: true }),
  status: z.enum(['ok', 'insufficient_data', 'constraint_violation', 'unsupported']),
  errorCode: z.string().nullable(), sourceEntities: z.array(AgentToolSourceSchema).max(100),
  assumptions: z.array(z.string().max(240)).max(20), gaps: z.array(z.string().max(240)).max(20),
}).strict();
export const AgentToolResultSchema = z.discriminatedUnion('tool', [
  AgentToolEnvelope.extend({tool:z.literal('bill_period_summary'),output:BillBriefSchema}),
  AgentToolEnvelope.extend({tool:z.literal('spending_baseline_comparison'),output:z.object({changes:BillBriefSchema.shape.changes}).strict()}),
  AgentToolEnvelope.extend({tool:z.literal('subscription_candidates'),output:z.object({candidates:BillBriefSchema.shape.subscriptionCandidates}).strict()}),
  AgentToolEnvelope.extend({tool:z.literal('evidence_detail'),output:EvidenceRefSchema}),
  AgentToolEnvelope.extend({tool:z.literal('dated_cashflow_forecast'),output:DatedCashflowForecastSchema}),

  AgentToolEnvelope.extend({ tool: z.literal('financial_overview'), output: z.object({
    checkingCents: MoneySchema, emergencyCents: MoneySchema, monthlyIncomeCents: MoneySchema,
    fixedBillsCents: MoneySchema, essentialSpendingCents: MoneySchema,
    availableMonthlyCents: MoneySchema, historyMonths: z.number().int().nonnegative(),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('essential_bills'), output: z.object({
    fixedBillsCents: MoneySchema, essentialSpendingCents: MoneySchema,
    bills: z.array(BillSchema).max(100),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('relevant_transactions'), output: z.object({
    transactions: z.array(TransactionSchema).max(30), category: z.string().nullable(),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('data_sufficiency'), output: z.object({
    sufficient: z.boolean(), historyMonths: z.number().int().nonnegative(),
    connectedSources: z.array(DataSourceKindSchema), coverageStart: IsoDateSchema.nullable(),
    coverageEnd: IsoDateSchema.nullable(),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('candidate_preview'), output: z.object({
    input: CandidateInputSchema, assessment: CandidateAssessmentSchema.nullable(),
    previewId: z.string().nullable(),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('search_goal_options'), output: z.object({
    objective: SearchGoalOptionsInputSchema.shape.objective,
    searchedRangeCents: z.object({ min: MoneySchema, max: MoneySchema }).strict(),
    evaluatedCount: z.number().int().nonnegative(),
    candidateResultIds: z.array(z.string().uuid()).max(3),
    excluded: z.array(z.object({ reason: z.enum(['same_date_higher_monthly',
      'negative_first_month_buffer']), count: z.number().int().nonnegative() }).strict()).max(2),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('stress_test_goal_options'), output: z.object({
    input: StressTestGoalOptionsInputSchema,
    scenarioBasis: z.literal('bounded_hypothesis'),
    results: z.array(z.object({ baselineResultId: z.string().uuid(),
      stressResultId: z.string().uuid(), scenario: StressScenarioSchema,
      baseline: CandidateAssessmentSchema, stressed: CandidateAssessmentSchema,
      outcome: z.enum(['holds', 'fails', 'insufficient_data']),
      failureReasons: z.array(z.enum(['PROJECTED_AFTER_TARGET', 'NO_PROJECTED_DATE',
        'FIRST_MONTH_SHORTFALL', 'TARGET_SHORTFALL', 'INSUFFICIENT_DATA'])).max(5),
    }).strict()).min(1).max(6),
  }).strict() }),
  AgentToolEnvelope.extend({ tool: z.literal('repair_stressed_goal_option'), output: z.object({
    input: RepairStressedGoalOptionInputSchema,
    baselineResultId: z.string().uuid(),
    scenario: StressScenarioSchema,
    status: z.enum(['repair_found', 'none_within_constraints']),
    searchedBounds: z.object({ monthlyContributionMaxCents: MoneySchema,
      latestAllowedDate: IsoDateSchema }).strict(),
    evaluatedCount: z.number().int().nonnegative(),
    repairs: z.array(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('monthly_contribution_increase'),
        proposedMonthlyContributionCents: MoneySchema, increaseCents: MoneySchema.positive(),
        assessment: CandidateAssessmentSchema }).strict(),
      z.object({ kind: z.literal('deadline_extension'),
        proposedTargetDate: IsoDateSchema, extensionDays: z.number().int().positive(),
        assessment: CandidateAssessmentSchema }).strict(),
    ])).max(2),
    unavailableReasons: z.array(z.enum(['MONTHLY_LIMIT', 'DEADLINE_LIMIT',
      'FIRST_MONTH_CAPACITY', 'NO_REPAIR_IN_SEARCH_BOUNDS'])).max(4),
  }).strict() }),
]);
export type AgentToolResult = z.infer<typeof AgentToolResultSchema>;

export const AgentDecisionSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('select_skill'),skillId:SkillIdSchema}).strict(),
  z.object({ type: z.literal('tool_call'), tool: z.string().min(1).max(80), input: z.unknown() }).strict(),
  z.object({ type: z.literal('ask_user'), question: z.string().min(1).max(180) }).strict(),
  z.object({ type: z.literal('recommend'), candidateResultIds: z.array(z.string().uuid()).min(1).max(3),
    tradeoff: z.enum(['earlier', 'lower_monthly', 'higher_buffer', 'balanced']) }).strict(),
  z.object({ type: z.literal('finish'), reason: z.enum(['no_viable_candidate', 'insufficient_data', 'unsupported']) }).strict(),
]);
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;
export const AgentRunStepSchema = z.object({
  kind: z.enum(['started', 'tool_completed', 'tool_failed', 'waiting', 'finished', 'stopped']),
  summary: z.string().min(1).max(240), at: z.string().datetime({ offset: true }),
  toolResultId: z.string().uuid().nullable(),
}).strict();
export const AgentRunSchema = z.object({
  runId: z.string().uuid(), taskId: z.string().uuid(), threadId: z.string().min(1),
  demoRunId: z.string().uuid(), triggeringMessageId: z.string().uuid(),
  status: z.enum(['running', 'completed', 'awaiting_user', 'cancelled', 'failed', 'timed_out', 'fallback']),
  revision: z.number().int().nonnegative(), provider: z.enum(['deepseek', 'deterministic']).nullable(),
  startedAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
  deadlineAt: z.string().datetime({ offset: true }), decisionCount: z.number().int().nonnegative(),
  toolCallCount: z.number().int().nonnegative(), reasonCode: z.string().nullable(),
  recommendedResultIds: z.array(z.string().uuid()).max(3), question: z.string().nullable(),
  steps: z.array(AgentRunStepSchema).max(100),
}).strict();
export type AgentRun = z.infer<typeof AgentRunSchema>;
export const MonitorStatusSchema = z.object({
  enabled: z.boolean(), goalId: z.string().nullable(),
  status: z.enum(['active', 'paused', 'cancelled']).nullable(),
  pendingEvents: z.number().int().nonnegative(),
});
export type MonitorStatus = z.infer<typeof MonitorStatusSchema>;
export const AgentRunStatusResponseSchema = z.object({ run: AgentRunSchema.nullable() }).strict();
export const AgentRunCancelRequestSchema = z.object({ runId: z.string().uuid() }).strict();

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
  'money_mission',
  'goal_planning', 'goal_status', 'goal_impact', 'mandate_management',
  'external_agent_request', 'clarification', 'rejected_prompt_injection',
]);
export type AgentIntent = z.infer<typeof AgentIntentSchema>;

const AgentComponentBase = z.object({ id: z.string().min(1) });
const AgentToneSchema = z.enum(['neutral', 'good', 'warning', 'danger']);
export const AgentComponentSchema = z.discriminatedUnion('type', [
  AgentComponentBase.extend({type:z.literal('mission_skill_result'),title:z.string(),twinVersion:z.number().int(),result:MissionSkillResultSchema}),
  AgentComponentBase.extend({ type: z.literal('explanation'), title: z.string(), body: z.string(), tone: AgentToneSchema }),
  AgentComponentBase.extend({ type: z.literal('goal_summary'), title: z.string(), goal: GoalSchema.pick({
    title: true, targetCents: true, savedCents: true, targetDate: true, protectedCents: true, status: true,
  }) }),
  AgentComponentBase.extend({ type: z.literal('feasibility'), title: z.string(), assessment: AssessmentSchema }),
  AgentComponentBase.extend({ type: z.literal('plan_compare'), title: z.string(), plans: z.array(PlanSchema).min(1).max(3) }),
  AgentComponentBase.extend({ type: z.literal('impact_summary'), title: z.string(), impact: ImpactSchema,
    protectedCents: MoneySchema }),
  AgentComponentBase.extend({ type: z.literal('expense_impact_answer'), title: z.string(),
    amountCents: MoneySchema.positive(), mode: z.enum(['hypothetical', 'reported']),
    summary: z.string(), cashFlowChange: z.string(), goalChange: z.string(),
    practicalMeaning: z.string(), nextStep: z.string(), question: z.string(),
    evidence: z.object({ twinVersion: z.number().int().positive(),
      baselineFirstMonthCapacityCents: MoneySchema, expenseFirstMonthCapacityCents: MoneySchema,
      baselineProjectedDate: IsoDateSchema.nullable(), expenseProjectedDate: IsoDateSchema.nullable(),
      baselineStatus: CandidateAssessmentSchema.shape.status,
      expenseStatus: CandidateAssessmentSchema.shape.status }).strict() }),
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
  AgentComponentBase.extend({ type: z.literal('data_connection_prompt'), title: z.string(), body: z.string(),
    threadId: z.string() }),
  AgentComponentBase.extend({ type: z.literal('error_recovery'), title: z.string(), body: z.string(), code: z.string() }),
  AgentComponentBase.extend({ type: z.literal('goal_input_card'), title: z.string(), goal: GoalSchema.pick({
    title: true, targetCents: true, savedCents: true, targetDate: true, protectedCents: true, status: true,
  }), draftId: z.string().optional(), fieldSources: z.record(z.string(), GoalFieldSourceSchema).default({}) }),
  AgentComponentBase.extend({ type: z.literal('goal_feasibility_card'), title: z.string(), assessment: AssessmentSchema }),
  AgentComponentBase.extend({ type: z.literal('goal_progress_card'), title: z.string(), goal: GoalSchema,
    progressPercent: z.number().min(0).max(100) }),
  AgentComponentBase.extend({ type: z.literal('assumption_editor'), title: z.string(),
    assumptions: GoalAssumptionsSchema, baseTwinVersion: z.number().int().positive(),
    fieldSources: z.record(z.string(), GoalFieldSourceSchema).default({}) }),
  AgentComponentBase.extend({ type: z.literal('what_if_simulator'), title: z.string(),
    assumptions: GoalAssumptionsSchema, baseTwinVersion: z.number().int().positive() }),
  AgentComponentBase.extend({ type: z.literal('scenario_compare'), title: z.string(), plans: z.array(PlanSchema).min(1).max(3),
    actions: z.array(z.object({ planId: z.string(), actionId: z.string().min(10) })).default([]),
    selectedPlanId: z.string().nullable().default(null) }),
  AgentComponentBase.extend({ type: z.literal('plan_steps'), title: z.string(), steps: z.array(PlanStepSchema) }),
  AgentComponentBase.extend({ type: z.literal('goal_impact_brief'), title: z.string(), body: z.string(),
    summary: WeeklyRiskSummarySchema.optional(), signal: GoalImpactSignalSchema.optional() }),
  AgentComponentBase.extend({ type: z.literal('notification_preference_card'), title: z.string(),
    preferences: RiskPreferencesSchema, goalId: z.string() }),
  AgentComponentBase.extend({ type: z.literal('agent_request_batch'), title: z.string(), body: z.string(),
    options: z.array(z.object({ id: z.enum(['execute', 'ask', 'manual_review', 'block']), label: z.string(), detail: z.string() })).length(4),
    action: z.object({ actionId: z.string().min(10), label: z.string() }) }),
  AgentComponentBase.extend({ type: z.literal('task_progress'), title: z.string(),
    status: AgentRunSchema.shape.status, steps: z.array(AgentRunStepSchema).max(20) }),
  AgentComponentBase.extend({ type: z.literal('monitoring_opt_in'), title: z.string(), body: z.string(),
    taskThreadId: z.string(), goalId: z.string(), enabled: z.boolean() }),
  AgentComponentBase.extend({ type: z.literal('monitor_followup_offer'), title: z.string(), body: z.string(),
    taskThreadId: z.string() }),
  AgentComponentBase.extend({ type: z.literal('candidate_recommendations'), title: z.string(), body: z.string(),
    taskThreadId: z.string().optional(),
    conditionalPlan: z.object({ monthlyContributionCents: MoneySchema.positive(),
      projectedDate: IsoDateSchema, targetDate: IsoDateSchema }).optional(),
    items: z.array(z.object({ resultId: z.string().uuid(), targetCents: MoneySchema.positive(),
      label: z.string().max(30).optional(),
      targetDate: IsoDateSchema, monthlyContributionCents: MoneySchema,
      firstMonthContributionCents: MoneySchema.optional(),
      protectedCents: MoneySchema, projectedDate: IsoDateSchema.nullable(),
      bufferCents: z.number().int(), status: z.enum(['on_track', 'at_risk']),
      tradeoff: z.enum(['earlier', 'lower_monthly', 'higher_buffer', 'balanced']),
      explanation: z.string(), assumptions: z.array(z.string()), gaps: z.array(z.string()) })).max(3) }),
  AgentComponentBase.extend({ type: z.literal('stress_analysis'), title: z.string(), body: z.string(),
    twinVersion: z.number().int().positive(), dataAsOf: IsoDateSchema,
    items: z.array(z.object({ baselineResultId: z.string().uuid(), stressResultId: z.string().uuid(),
      scenarioLabel: z.string().max(120), outcome: z.enum(['holds', 'fails', 'insufficient_data']),
      explanation: z.string().max(900), repairText: z.string().max(500),
    }).strict()).min(1).max(6) }),
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
export const AgentTurnWithRunSchema = AgentTurnSchema.extend({ run: AgentRunSchema.nullable() });
export type AgentTurnWithRun = z.infer<typeof AgentTurnWithRunSchema>;

export const SnapshotSchema = z.object({
  moneyMission: MoneyMissionReadModelSchema.optional(),
  mission: MissionSchema.optional(),
  goal: GoalSchema, finance: FinanceSchema, assessment: AssessmentSchema,
  goals: z.array(GoalSchema).default([]), primaryGoalId: z.string().nullable().default(null),
  primaryGoal: GoalSchema.nullable().default(null),
  pendingImpact: ImpactSchema.nullable(), mandate: MandateSchema.nullable(),
  audit: z.array(AuditSchema), operations: z.array(OperationSchema),
  receipts: z.array(ReceiptSchema), approvalSummaries: z.array(ApprovalSchema.omit({ token: true })),
  auditChainValid: z.boolean(), twinVersion: z.number().int().positive(),
  cards: z.array(UiCardSchema), clock: IsoDateSchema,
  riskPreferences: RiskPreferencesSchema,
  spendingPatterns: z.array(SpendingPatternSchema),
  riskSignals: z.array(GoalImpactSignalSchema),
  weeklyRiskSummaries: z.array(WeeklyRiskSummarySchema),
  dataConnections: z.array(DataConnectionSchema).default([]),
  dataSyncBatches: z.array(DataSyncBatchSchema).default([]),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;
