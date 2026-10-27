import { z } from 'zod';

const cents = z.number().int().nonnegative();
const date = z.iso.date();
export const AccountSnapshotSchema = z.object({
  id: z.string(), accountId: z.string(), balanceCents: cents, currency: z.string().length(3), asOf: date,
  source: z.enum(['simulated_connection', 'user_confirmed']), confirmed: z.boolean(), twinVersion: z.number().int().positive(),
});
export const NormalizedStatementRowSchema = z.object({
  id: z.string(), externalId: z.string(), accountId: z.string(), currency: z.string().length(3), date,
  title: z.string().max(240), merchantId: z.string().nullable(), amountCents: z.number().int(), category: z.string(),
  originalCategory: z.string(), sourceKind: z.enum(['bank', 'wechat_pay', 'alipay']), rawDescription: z.string().max(1000),
  confidence: z.number().min(0).max(1), excludedReason: z.enum(['income', 'duplicate', 'refund_match', 'internal_transfer']).nullable(),
  batchId: z.string().nullable(),
});
export const ImportIssueSchema = z.object({
  id: z.string(), batchId: z.string(), rowId: z.string(),
  kind: z.enum(['invalid_date', 'invalid_amount', 'missing_field', 'duplicate', 'refund_match', 'internal_transfer', 'low_confidence']),
  severity: z.enum(['blocking', 'review', 'info']), field: z.string(), originalValue: z.string(), correctedValue: z.string().nullable(), resolved: z.boolean(),
});
export const StatementImportBatchSchema = z.object({
  revision:z.number().int().nonnegative().optional(),
  id: z.string(), templateId: z.string(), format: z.enum(['csv', 'xlsx', 'pdf', 'image']),
  status: z.enum(['preview', 'needs_review', 'ready', 'committed', 'revoked', 'failed']),
  coverageStart: date.nullable(), coverageEnd: date.nullable(), recordCount: cents, duplicateCount: cents,
  issueIds: z.array(z.string()), rowIds: z.array(z.string()), createdAt: z.string(), committedAt: z.string().nullable(), twinVersion: z.number().int().positive(),
});
export const EvidenceRefSchema = z.object({
  sourceRefs: z.array(z.string()).optional(),
  id: z.string(), claimType: z.enum(['fact', 'assumption', 'prediction', 'limitation']),
  sourceKind: z.enum(['transaction', 'account_snapshot', 'user_assumption', 'system_calculated', 'merchant_result']),
  sourceId: z.string(), dataAsOf: date, label: z.string().max(300), confidence: z.number().min(0).max(1), transactionIds: z.array(z.string()),
});
export const BillBriefSchema = z.object({
  id: z.string(), twinVersion: z.number().int(), periodStart: date, periodEnd: date, dataAsOf: date,
  totalExpenseCents: cents, categories: z.array(z.object({ category: z.string(), amountCents: cents, count: cents, evidenceIds: z.array(z.string()) })),
  changes: z.array(z.object({ category: z.string(), baselineCents: cents, currentCents: cents, increaseCents: z.number().int(), evidenceIds: z.array(z.string()) })),
  subscriptionCandidates: z.array(z.object({ id: z.string(), merchantId: z.string(), title: z.string(), monthlyCents: cents, nextChargeDate: date, confidence: z.number(), wording: z.string(), evidenceIds: z.array(z.string()) })),
  claims: z.array(EvidenceRefSchema), limitations: z.array(z.string()),
});
export const SubscriptionActionSchema = z.object({
  id: z.string(), subscriptionId: z.string(), merchantId: z.string(), action: z.enum(['keep', 'remind', 'cancel', 'not_subscription']),
  status: z.enum(['prepared', 'awaiting_confirmation', 'executing', 'succeeded', 'failed', 'requires_merchant', 'unknown', 'reconciled', 'cancelled']),
  monthlyCents: cents, effectiveAt: date, paidThrough: date, cancelledAt: z.string().nullable(), nextChargeSuppressed: z.boolean(),
  refundCents: cents, merchantOperationId: z.string().nullable(), approvalId: z.string().nullable(), snapshotHash: z.string().nullable(),
  twinVersion: z.number().int(), idempotencyKey: z.string(), receiptId: z.string().nullable(),
});
export const CashflowEventSchema = z.object({
  id: z.string(), date, priority: z.number().int(), accountId: z.string(), label: z.string(), amountCents: z.number().int(), balanceCents: z.number().int(),
  currency: z.string().length(3), claimType: z.enum(['fact', 'assumption', 'prediction']), sourceRefs: z.array(z.string()),
});
export const DatedCashflowForecastSchema = z.object({
  forecastId: z.string().nullable(), twinVersion: z.number().int(), accountId: z.string(), horizonEnd: date, scenario: z.enum(['baseline', 'stress', 'edited']),
  precision: z.enum(['exact', 'range', 'insufficient_balance']), minimumBalanceCents: z.number().int().nullable(), minimumBalanceDate: date.nullable(),
  events: z.array(CashflowEventSchema), assumptions: z.array(z.string()), limitations: z.array(z.string()), dataAsOf: date,
});
export const CashflowEditSchema = z.object({ eventId: z.string().optional(), operation: z.enum(['add','replace','remove']).optional(), date, label: z.string().max(80), amountCents: z.number().int(), currency: z.string().length(3).default('CNY') });
export const GoalPlanOptionSchema = z.object({
  id: z.string(), goalId: z.string(), label: z.string(), monthlyCents: cents, upfrontCents: cents, occurrences: cents,
  firstMonthContributionCents: cents, projectedDate: date.nullable(), minimumBalanceCents: z.number().int().nullable(),
  forecastId: z.string().nullable(), twinVersion: z.number().int(), executable: z.boolean(), conflicts: z.array(z.string()), explanation: z.string(),
});
export const SalaryTriggerSchema = z.object({
  type: z.enum(['fixed_day', 'salary_event']), expectedDay: z.number().int().min(1).max(28), executeOffsetDays: z.literal(1),
  executeTime: z.literal('09:00'), missingEventPolicy: z.literal('skip_no_catchup'), graceDay: z.literal(27),
  minimumSalaryCents: cents, maximumSalaryCents: cents, sourceAccountId: z.string(),
});
export const TransferScheduleSchema = z.object({
  targetCents:cents,
  id: z.string(), goalId: z.string(), sourceAccountId: z.string(), destinationAccountId: z.string(), currency: z.literal('CNY'),
  amountCents: cents.positive(), frequency: z.enum(['one_time', 'monthly']),
  status: z.enum(['draft', 'simulated', 'awaiting_confirmation', 'active', 'paused', 'completed', 'failed', 'cancelled']),
  trigger: SalaryTriggerSchema, createdAt: z.string(), endDate: date, forecastId: z.string(), twinVersion: z.number().int(),
  authorizationHash: z.string(), approvalId: z.string().nullable(), snapshotHash: z.string().nullable(), nextEvaluationDate: date,
});
export const TransferSchedulePreviewSchema = TransferScheduleSchema.extend({
  cycles: z.array(z.object({ expectedDate: date, amountCents: cents, minimumBalanceCents: z.number().int() })).max(3),
  limitations: z.array(z.string()),
});
export const TransferExecutionSchema = z.object({
  id: z.string(), scheduleId: z.string(), periodKey: z.string(), operationId: z.string().nullable(),
  status: z.enum(['scheduled', 'succeeded', 'failed', 'unknown', 'skipped_missing_trigger', 'reconciled']),
  amountCents: cents, createdAt: z.string(), reason: z.string(), triggerTransactionId: z.string().nullable(),
});
export const HandoffCasePackSchema = z.object({
  id: z.string(), createdAt: z.string(), problem: z.string(), goalTitle: z.string(), facts: z.array(z.string()),
  evidenceIds: z.array(z.string()), attemptedSteps: z.array(z.string()), questions: z.array(z.string()), limitations: z.array(z.string()),
});
export const SkillIdSchema = z.enum(['statement_ingestion_and_reconciliation', 'bill_and_subscription_investigator', 'dated_cashflow_forecast', 'goal_portfolio_planner', 'transfer_and_savings_executor', 'mandate_builder', 'external_agent_request_inbox', 'outcome_monitor_and_replanner', 'financial_explanation_and_provenance', 'human_handoff_case_pack']);
export const SkillDefinitionSchema = z.object({ id: SkillIdSchema, version: z.literal('1.0.0'), enabled: z.boolean(), release: z.enum(['p0', 'p1_stretch']), description: z.string(), tools: z.array(z.string()), maxToolCalls: z.number().int().positive(), confirmationRequired: z.boolean() });
export const MissionSkillResultSchema = z.object({skillId:SkillIdSchema,artifactId:z.string(),stage:z.enum(['data','bills','planning','transfer','monitoring','handoff']),summary:z.string().max(1000),claims:z.array(z.object({claimType:z.enum(['fact','assumption','prediction','limitation']),text:z.string().max(400),sourceRefs:z.array(z.string()).min(1)})).max(30),requiresConfirmation:z.boolean()}).strict();
export const MissionNotificationSchema=z.object({id:z.string(),subjectKey:z.string(),goalId:z.string(),sourceId:z.string(),kind:z.enum(['transfer_failed','transfer_unknown','missing_salary','goal_changed','subscription_price']),status:z.enum(['unread','read','deferred','resolved']),createdAt:z.string(),body:z.string().max(400),proposedActions:z.array(z.enum(['query','pause','replan','contact_merchant']))});
export const MissionStageSchema = z.enum(['goal', 'data', 'bills', 'subscription', 'planning', 'transfer', 'monitoring']);
export const MissionNextCtaSchema = z.object({ id: z.string(), label: z.string().max(80), stage: MissionStageSchema });
export const MissionRepairPreviewSchema = z.object({
  id: z.string(), sourceId: z.string(), kind: z.enum(['skip_period', 'adjust_date', 'pause_schedule', 'query_operation', 'replan']),
  label: z.string().max(80), explanation: z.string().max(300), appliesImmediately: z.literal(false),
});
export const MoneyMissionReadModelSchema = z.object({
  monitoringEnabled:z.boolean(),notifications:z.array(MissionNotificationSchema),handoffCasePacks:z.array(HandoffCasePackSchema),
  stage: MissionStageSchema, twinVersion: z.number().int(), dataAsOf: date,
  batches: z.array(StatementImportBatchSchema), issues: z.array(ImportIssueSchema), billBrief: BillBriefSchema.nullable(),
  forecast: DatedCashflowForecastSchema.nullable(), plans: z.array(GoalPlanOptionSchema), subscriptionActions: z.array(SubscriptionActionSchema),
  schedules: z.array(TransferScheduleSchema.omit({ authorizationHash: true, snapshotHash: true })), executions: z.array(TransferExecutionSchema),
  completedStages: z.array(MissionStageSchema).optional(),
  nextCta: MissionNextCtaSchema.nullable().optional(),
  repairPreviews: z.array(MissionRepairPreviewSchema).optional(),
});

export type AccountSnapshot = z.infer<typeof AccountSnapshotSchema>;
export type NormalizedStatementRow = z.infer<typeof NormalizedStatementRowSchema>;
export type StatementImportBatch = z.infer<typeof StatementImportBatchSchema>;
export type ImportIssue = z.infer<typeof ImportIssueSchema>;
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;
export type BillBrief = z.infer<typeof BillBriefSchema>;
export type SubscriptionAction = z.infer<typeof SubscriptionActionSchema>;
export type DatedCashflowForecast = z.infer<typeof DatedCashflowForecastSchema>;
export type CashflowEdit = z.infer<typeof CashflowEditSchema>;
export type GoalPlanOption = z.infer<typeof GoalPlanOptionSchema>;
export type TransferSchedule = z.infer<typeof TransferScheduleSchema>;
export type TransferSchedulePreview = z.infer<typeof TransferSchedulePreviewSchema>;
export type TransferExecution = z.infer<typeof TransferExecutionSchema>;
export type HandoffCasePack = z.infer<typeof HandoffCasePackSchema>;
export type SkillId = z.infer<typeof SkillIdSchema>;
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;

export type MoneyMissionReadModel = z.infer<typeof MoneyMissionReadModelSchema>;
export type MissionStage = z.infer<typeof MissionStageSchema>;
export type MissionNextCta = z.infer<typeof MissionNextCtaSchema>;
export type MissionRepairPreview = z.infer<typeof MissionRepairPreviewSchema>;
export type MissionNotification=z.infer<typeof MissionNotificationSchema>;
