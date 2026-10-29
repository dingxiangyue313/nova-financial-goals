import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {protectedCheckingReserve} from './financial-constraints.ts';
import { DatedCashflowForecastInputSchema, SubscriptionActionInputSchema, SubscriptionCancellationInputSchema, TransferScheduleInputSchema, type DemoState, type Operation,
  type Receipt, type ToolRecord } from '../shared/contracts.ts';
import { executeSubscriptionCancellation, persistSubscriptionDecision, prepareSubscriptionAction, reconcileSubscriptionCancellation } from './subscription-service.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { cancelTransferSchedule, getTransferScheduleStatus, pauseTransferSchedule, simulateTransferSchedule,
  transferScheduleApprovalParameters, TransferScheduleLifecycleSchema } from './transfer-schedules.ts';
import { assessGoal } from './domain.ts';
import { activatePlan } from './domain.ts';
import { approveOperation, evaluateExternalRequest, reconcileOperation } from './tools.ts';
import {
  appendAuditEvent,
  confirmApproval,
  consumeApproval,
  createApprovalSnapshot,
  financialTwin,
  stableHash,
  verifyAuditChain,
} from './governance.ts';

const money = z.number().int().positive();
const schemas = {
  get_financial_snapshot: z.object({}),
  list_accounts: z.object({}),
  list_transactions: z.object({ accountId: z.string().optional(), limit: z.number().int().min(1).max(100).default(50) }),
  list_bills: z.object({}),
  list_subscriptions: z.object({ status: z.enum(['active', 'cancelled', 'all']).default('active') }),
  prepare_subscription_action: SubscriptionActionInputSchema,
  execute_subscription_cancellation: SubscriptionCancellationInputSchema,
  get_subscription_action_status: z.object({ actionId: z.string().min(1) }).strict(),
  forecast_cashflow: z.object({ horizonDays: z.number().int().min(1).max(365).default(30) }),
  dated_cashflow_forecast: DatedCashflowForecastInputSchema,
  simulate_transfer_schedule: TransferScheduleInputSchema,
  prepare_recurring_transfer: TransferScheduleInputSchema,
  get_transfer_schedule_status: z.object({ scheduleId: z.string().min(1) }).strict(),
  pause_transfer_schedule: TransferScheduleLifecycleSchema,
  cancel_transfer_schedule: TransferScheduleLifecycleSchema,
  assess_goal_feasibility: z.object({}),
  simulate_goal_plan: z.object({}),
  compare_scenarios: z.object({}),
  get_goal_progress: z.object({}),
  create_goal: z.object({ title: z.string().min(1).max(60), targetCents: money,
    targetDate: z.iso.date(), protectedCents: z.number().int().nonnegative(), quote: z.string().max(500).default(''),
    flexibilityWeeks: z.number().int().min(0).max(52).default(2), id: z.string().optional(),
    monthlyContributionCents: z.number().int().nonnegative().default(0) }),
  update_goal: z.object({ title: z.string().min(1).max(60).optional(), targetCents: money.optional(),
    targetDate: z.iso.date().optional(), protectedCents: z.number().int().nonnegative().optional(),
    monthlyContributionCents: z.number().int().nonnegative().optional(), quote: z.string().max(500).optional(),
    flexibilityWeeks: z.number().int().min(0).max(52).optional() }),
  select_goal_plan: z.object({ planId: z.enum(['conservative', 'balanced', 'accelerated']) }),
  activate_goal: z.object({ planId: z.enum(['conservative', 'balanced', 'accelerated']), approvalToken: z.string() }),
  apply_goal_candidate: z.object({ goalId: z.string().min(1), title: z.string().min(1).max(60),
    savedCents: z.number().int().nonnegative(), targetCents: money, targetDate: z.iso.date(),
    originalDate: z.iso.date(), monthlyContributionCents: z.number().int().nonnegative(),
    firstMonthContributionCents: z.number().int().nonnegative().optional(),
    protectedCents: z.number().int().nonnegative(), approvalParameters: z.record(z.string(), z.unknown()),
    approvalToken: z.string() }),
  create_approval_snapshot: z.object({ action: z.string().min(1), parameters: z.record(z.string(), z.unknown()), expiresInSeconds: z.number().int().min(60).max(1800).default(300) }),
  confirm_approval: z.object({ approvalId: z.string(), snapshotHash: z.string(), confirmed: z.literal(true) }),
  permission_check: z.object({ action: z.string(), parameters: z.record(z.string(), z.unknown()), approvalToken: z.string().optional(), mandateId: z.string().optional() }),
  risk_check: z.object({ amountCents: z.number().int().nonnegative().optional(), sourceAccountId: z.string().optional(), snapshotId: z.string().optional() }),
  prepare_transfer: z.object({ sourceAccountId: z.string(), destinationAccountId: z.string(), amountCents: money }),
  execute_transfer: z.object({ draftId: z.string(), snapshotId: z.string(), approvalToken: z.string(), idempotencyKey: z.string().min(1).max(100) }),
  get_operation_status: z.object({ operationId: z.string() }),
  quote_fx: z.object({ fromCurrency: z.string().length(3), toCurrency: z.string().length(3), amountCents: money }),
  prepare_fx_order: z.object({ quoteId: z.string(), sourceAccountId: z.string(), destinationAccountId: z.string() }),
  execute_fx_order: z.object({ draftId: z.string(), quoteId: z.string(), approvalToken: z.string(), idempotencyKey: z.string().min(1).max(100) }),
  create_mandate: z.object({ agentId: z.string(), category: z.string(), maxPerOperationCents: money, totalLimitCents: money, expiresAt: z.iso.date(), approvalToken: z.string() }),
  update_mandate: z.object({ mandateId: z.string(), category: z.string(), maxPerOperationCents: money,
    totalLimitCents: money, expiresAt: z.iso.date(), approvalToken: z.string() }),
  list_mandates: z.object({}),
  pause_mandate: z.object({ mandateId: z.string(), approvalToken: z.string() }),
  revoke_mandate: z.object({ mandateId: z.string(), approvalToken: z.string() }),
  evaluate_external_request: z.object({ agentId: z.string(), category: z.string(), amountCents: money,
    idempotencyKey: z.string().min(1).max(100), simulateTimeout: z.boolean().default(false) }),
  approve_external_operation: z.object({ operationId: z.string(), approvalToken: z.string() }),
  reconcile_operation: z.object({ operationId: z.string() }),
  detect_financial_signals: z.object({}),
  explain_decision: z.object({ operationId: z.string() }),
  get_activity: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
  export_audit_report: z.object({ format: z.enum(['json', 'csv']).default('json') }),
} satisfies Record<string, z.ZodTypeAny>;

export type BankingToolName = keyof typeof schemas;
const readOnly = new Set<BankingToolName>([
  'get_financial_snapshot', 'list_accounts', 'list_transactions', 'list_bills', 'list_subscriptions',
  'forecast_cashflow', 'dated_cashflow_forecast', 'assess_goal_feasibility', 'simulate_goal_plan', 'compare_scenarios',
  'get_goal_progress', 'permission_check', 'risk_check', 'get_operation_status', 'list_mandates',
  'detect_financial_signals', 'explain_decision', 'get_activity', 'export_audit_report',
  'simulate_transfer_schedule', 'get_transfer_schedule_status',
]);

export const bankingToolDefinitions = (Object.keys(schemas) as BankingToolName[])
  .filter(name => name !== 'apply_goal_candidate').map(name => ({
  name,
  description: `NOVA simulated banking capability: ${name}`,
  annotations: { readOnlyHint: readOnly.has(name), destructiveHint: name === 'revoke_mandate' },
}));

type ToolContext = { userConfirmed?: boolean };
type ToolOutcome = { state: DemoState; result: any };
const todayTime = (state: DemoState) => `${state.clock}T12:00:00.000Z`;
const endOfDay = (state: DemoState) => `${state.clock}T23:59:59.999Z`;

function record(state: DemoState, item: ToolRecord): DemoState {
  return { ...state, toolRecords: [...state.toolRecords, item] };
}

function updateRecord(state: DemoState, id: string, status: ToolRecord['status']): DemoState {
  return { ...state, toolRecords: state.toolRecords.map(item => item.id === id ? { ...item, status } : item) };
}

function account(state: DemoState, id: string) {
  const found = state.accounts.find(item => item.id === id);
  if (!found) throw new Error('ACCOUNT_NOT_FOUND');
  return found;
}

function appendPipeline(state: DemoState, operationId: string, detail: string): DemoState {
  let next = appendAuditEvent(state, 'permission', 'checked', 'Approval 或 Mandate 已覆盖操作', { operationId });
  next = appendAuditEvent(next, 'risk', 'checked', '余额、安全资金、版本和幂等检查通过', { operationId });
  next = appendAuditEvent(next, 'execute', 'simulated', detail, { operationId });
  next = appendAuditEvent(next, 'verify', 'confirmed', 'Twin 版本、余额和凭证已核对', { operationId });
  return appendAuditEvent(next, 'audit', 'recorded', '操作证据已写入 Hash 链', { operationId });
}

function previousOperation(state: DemoState, key: string, inputHash: string) {
  const previous = state.operations.find(item => item.idempotencyKey === key);
  if (!previous) return null;
  if (previous.inputHash !== inputHash) throw new Error('IDEMPOTENCY_CONFLICT');
  return previous;
}

function executedOperation(state: DemoState, tool: string, key: string, inputHash: string, amountCents: number): { state: DemoState; operation: Operation; receipt: Receipt } {
  const operationId = randomUUID();
  const receipt: Receipt = { operationId, tool, status: 'succeeded', amountCents, currency: 'CNY',
    executedAt: todayTime(state), twinVersion: state.twinVersion };
  const operation: Operation = { operationId, idempotencyKey: key, inputHash, tool, status: 'executed',
    originalDecision: 'execute', category: tool, amountCents,
    reason: 'Permission、Risk、Execute 与 Verify 均已通过。', receipt,
    createdAt: todayTime(state), verificationRequirement: 'none', verificationStatus: 'not_required',
    balanceBeforeCents: state.finance.checkingCents, balanceAfterCents: state.finance.checkingCents,
    mandateSpentBeforeCents: state.mandate?.spentCents ?? null, mandateSpentAfterCents: state.mandate?.spentCents ?? null,
    twinVersionBefore: state.twinVersion, twinVersionAfter: state.twinVersion };
  return { state: { ...state, operations: [...state.operations, operation], receipts: [...state.receipts, receipt] }, operation, receipt };
}

export function runBankingTool(state: DemoState, name: BankingToolName, raw: unknown, context: ToolContext = {}): ToolOutcome {
  const schema = schemas[name];
  if (!schema) throw new Error('UNKNOWN_TOOL');
  const input = schema.parse(raw) as Record<string, any>;
  switch (name) {
    case 'get_financial_snapshot': return { state, result: financialTwin(state) };
    case 'list_accounts': return { state, result: { accounts: state.accounts } };
    case 'list_transactions': return { state, result: { transactions: state.transactions
      .filter(item => !input.accountId || item.accountId === input.accountId).slice(0, input.limit) } };
    case 'list_bills': return { state, result: { bills: state.bills } };
    case 'list_subscriptions': return { state, result: { subscriptions: state.subscriptions
      .filter(item => input.status === 'all' || item.status === input.status) } };
    case 'prepare_subscription_action': {
      const preview = prepareSubscriptionAction(state, SubscriptionActionInputSchema.parse(input));
      const next = preview.action.action !== 'cancel' ? persistSubscriptionDecision(state, preview.action)
        : appendAuditEvent({ ...state, subscriptionActions: [...state.subscriptionActions, preview.action] },
          'subscription_action_prepared', preview.action.status, preview.consequences.join(' '));
      return { state: next, result: preview };
    }
    case 'execute_subscription_cancellation': {
      const result = executeSubscriptionCancellation(state, SubscriptionCancellationInputSchema.parse(input));
      return { state: result.state, result: { action: result.action, receipt: result.receipt } };
    }
    case 'get_subscription_action_status': {
      const result = reconcileSubscriptionCancellation(state, input.actionId);
      return { state: result.state, result: { action: result.action } };
    }
    case 'forecast_cashflow': {
      const horizonEnd = new Date(Date.parse(`${state.clock}T00:00:00Z`) + input.horizonDays * 86_400_000).toISOString().slice(0, 10);
      const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd, scenario: 'baseline' });
      const safeToSpendCents = Math.max(0, state.finance.monthlyIncomeCents - state.finance.fixedBillsCents - state.finance.essentialSpendingCents);
      return { state, result: { ...forecast, forecastId: forecast.executableForecastId,
        horizonDays: input.horizonDays, safeToSpendCents,
        projectedCheckingCents: forecast.dailyBalances.at(-1)?.balanceCents ?? null,
        protectedCents: state.finance.emergencyCents } };
    }
    case 'dated_cashflow_forecast': return { state, result: buildDatedCashflowForecast(state, DatedCashflowForecastInputSchema.parse(input)) };
    case 'simulate_transfer_schedule': return { state, result: simulateTransferSchedule(state, TransferScheduleInputSchema.parse(input)) };
    case 'prepare_recurring_transfer': {
      const preview = simulateTransferSchedule(state, TransferScheduleInputSchema.parse(input));
      return { state: { ...state, transferSchedulePreviews: [...state.transferSchedulePreviews.filter(item => item.id !== preview.id), preview] },
        result: { preview, approvalParameters: transferScheduleApprovalParameters(preview) } };
    }
    case 'get_transfer_schedule_status': return { state, result: { schedule: getTransferScheduleStatus(state, input.scheduleId) } };
    case 'pause_transfer_schedule': {
      const outcome = pauseTransferSchedule(state, TransferScheduleLifecycleSchema.parse(input));
      return { state: outcome.state, result: { schedule: outcome.schedule } };
    }
    case 'cancel_transfer_schedule': {
      const outcome = cancelTransferSchedule(state, TransferScheduleLifecycleSchema.parse(input));
      return { state: outcome.state, result: { schedule: outcome.schedule } };
    }
    case 'assess_goal_feasibility': return { state, result: assessGoal(state) };
    case 'simulate_goal_plan': return { state, result: { plans: assessGoal(state).plans } };
    case 'compare_scenarios': return { state, result: { scenarios: assessGoal(state).plans } };
    case 'get_goal_progress': return { state, result: { goal: state.goal, assessment: assessGoal(state) } };
    case 'create_goal': {
      const existing = state.goals.find(goal => goal.id === input.id)
        ?? state.goals.find(goal => goal.title === input.title);
      const savedCents = existing?.savedCents ?? 0;
      const created = { ...state.goal, id: existing?.id ?? input.id ?? randomUUID(), title: input.title,
        targetCents: input.targetCents, savedCents, targetDate: input.targetDate, originalDate: input.targetDate,
        protectedCents: input.protectedCents, flexibilityWeeks: input.flexibilityWeeks, quote: input.quote,
        status: 'draft' as const, selectedPlanId: null, monthlyContributionCents: input.monthlyContributionCents };
      const goals = existing ? state.goals.map(goal => goal.id === existing.id ? created : goal) : [...state.goals, created];
      let next: DemoState = { ...state, twinVersion: state.twinVersion + 1,
        goal: created, goals, primaryGoalId: state.primaryGoalId ?? created.id,
        finance: { ...state.finance, emergencyCents: input.protectedCents }, pendingImpact: null, mandate: null,
        accounts: state.accounts.map(item => item.id === 'emergency' ? { ...item, balanceCents: input.protectedCents }
          : item.id === 'goal-wallet' ? { ...item, balanceCents: savedCents } : item) };
      next = appendAuditEvent(next, 'create_goal', 'draft', input.title);
      return { state: next, result: { goal: next.goal, twinVersion: next.twinVersion } };
    }
    case 'update_goal': {
      const updated = { ...state.goal, ...input, originalDate: input.targetDate ?? state.goal.originalDate,
        status: 'draft' as const, selectedPlanId: null,
        monthlyContributionCents: input.monthlyContributionCents ?? 0 };
      let next: DemoState = { ...state, twinVersion: state.twinVersion + 1,
        goal: updated, goals: state.goals.map(goal => goal.id === updated.id ? updated : goal),
        finance: input.protectedCents === undefined ? state.finance : { ...state.finance, emergencyCents: input.protectedCents },
        accounts: input.protectedCents === undefined ? state.accounts : state.accounts.map(item => item.id === 'emergency' ? { ...item, balanceCents: input.protectedCents } : item),
        pendingImpact: null, mandate: null };
      next = appendAuditEvent(next, 'update_goal', 'draft', '目标参数已修改，方案需要重新选择');
      return { state: next, result: { goal: next.goal, twinVersion: next.twinVersion } };
    }
    case 'select_goal_plan': {
      const plan = assessGoal(state).plans.find(item => item.id === input.planId);
      if (!plan || plan.status === 'infeasible') throw new Error('PLAN_NOT_AVAILABLE');
      const updated = { ...state.goal, selectedPlanId: plan.id, monthlyContributionCents: plan.monthlyCents, status: 'draft' as const };
      let next: DemoState = { ...state, twinVersion: state.twinVersion + 1,
        goal: updated, goals: state.goals.map(goal => goal.id === updated.id ? updated : goal) };
      next = appendAuditEvent(next, 'select_goal_plan', 'selected', plan.id);
      return { state: next, result: { goal: next.goal, twinVersion: next.twinVersion } };
    }
    case 'activate_goal': {
      let next = consumeApproval(state, input.approvalToken, 'activate_goal', { planId: input.planId });
      next = { ...activatePlan(next, input.planId), twinVersion: next.twinVersion + 1 };
      next = appendPipeline(next, `goal-${next.goal.id}`, '目标计划已激活');
      return { state: next, result: { goal: next.goal, twinVersion: next.twinVersion } };
    }
    case 'apply_goal_candidate': {
      let next = consumeApproval(state, input.approvalToken, 'apply_goal_candidate', input.approvalParameters);
      const previous = next.goals.find(item => item.id === input.goalId);
      if (previous && previous.savedCents !== input.savedCents) throw new Error('GOAL_SAVED_AMOUNT_CHANGED');
      const goal = { ...next.goal, id: input.goalId, title: input.title,
        savedCents: input.savedCents, targetCents: input.targetCents,
        targetDate: input.targetDate, originalDate: input.originalDate,
        monthlyContributionCents: input.monthlyContributionCents,
        firstMonthContributionCents: input.firstMonthContributionCents,
        protectedCents: input.protectedCents, flexibilityWeeks: 0,
        selectedPlanId: 'custom', status: 'active' as const,
        quote: '由 NOVA 已验证候选应用' };
      next = { ...next, twinVersion: next.twinVersion + 1, goal,
        goals: previous ? next.goals.map(item => item.id === goal.id ? goal : item) : [...next.goals, goal],
        primaryGoalId: goal.id, pendingImpact: null };
      next = appendPipeline(next, `goal-${goal.id}`, '已验证候选目标已激活');
      return { state: next, result: { goal, twinVersion: next.twinVersion } };
    }
    case 'create_approval_snapshot': {
      const expiresAt = new Date(Date.parse(todayTime(state)) + input.expiresInSeconds * 1000).toISOString();
      const created = createApprovalSnapshot(state, input.action, input.parameters, expiresAt);
      const next = appendAuditEvent(created.state, 'approval_viewed', 'pending', input.action, { approvalId: created.approval.id });
      return { state: next, result: { approvalId: created.approval.id, snapshotHash: created.approval.snapshotHash, expiresAt } };
    }
    case 'confirm_approval': {
      if (!context.userConfirmed) throw new Error('USER_CONFIRMATION_REQUIRED');
      const confirmed = confirmApproval(state, input.approvalId, input.snapshotHash);
      const next = appendAuditEvent(confirmed.state, 'approval_confirmed', 'approved', '用户明确确认固定参数', { approvalId: input.approvalId });
      return { state: next, result: { approvalToken: confirmed.token, status: 'approved' } };
    }
    case 'permission_check': {
      const approval = input.approvalToken ? state.approvals.find(item => item.token === input.approvalToken && item.status === 'confirmed' &&
        item.action === input.action && item.twinVersion === state.twinVersion && item.expiresAt > todayTime(state) &&
        stableHash(item.parameters) === stableHash(input.parameters)) : null;
      const mandate = input.mandateId && state.mandate && state.mandate.id === input.mandateId && state.mandate.active &&
        state.mandate.expiresAt >= state.clock && (!input.parameters.agentId || input.parameters.agentId === state.mandate.agentId) &&
        (!input.parameters.category || input.parameters.category === state.mandate.category) &&
        (!input.parameters.amountCents || (Number(input.parameters.amountCents) <= state.mandate.maxPerOperationCents &&
          Number(input.parameters.amountCents) + state.mandate.spentCents <= state.mandate.totalLimitCents));
      return { state, result: { allowed: Boolean(approval || mandate), source: approval ? 'approval' : mandate ? 'mandate' : 'none' } };
    }
    case 'risk_check': {
      if (input.snapshotId && input.snapshotId !== financialTwin(state).snapshotId) throw new Error('TWIN_VERSION_CHANGED');
      const source = input.sourceAccountId ? account(state, input.sourceAccountId) : null;
      const amount = input.amountCents ?? 0;
      const protectedFundsIntact=!source?.protected&&(!source||source.type!=='checking'||source.balanceCents-amount>=protectedCheckingReserve(state));
      return { state, result: { allowed: protectedFundsIntact && (!source || source.balanceCents >= amount),
        protectedFundsIntact, balanceAfterCents: source ? source.balanceCents - amount : null } };
    }
    case 'prepare_transfer': {
      const source = account(state, input.sourceAccountId);
      const destination = account(state, input.destinationAccountId);
      if (source.protected) throw new Error('PROTECTED_ACCOUNT');
      if (source.currency !== destination.currency) throw new Error('CURRENCY_MISMATCH_USE_FX');
      if (source.balanceCents < input.amountCents) throw new Error('INSUFFICIENT_BALANCE');
      if(source.type==='checking'&&source.balanceCents-input.amountCents<protectedCheckingReserve(state))throw new Error('PROTECTED_FUNDS_UNAVAILABLE');
      const item: ToolRecord = { id: randomUUID(), kind: 'transfer_draft', status: 'prepared', expiresAt: null,
        data: { ...input, twinVersion: state.twinVersion, snapshotId: financialTwin(state).snapshotId } };
      const next = appendAuditEvent(record(state, item), 'transfer_prepared', 'prepared', '模拟转账草案已生成');
      return { state: next, result: { draftId: item.id, snapshotId: item.data.snapshotId, amountCents: input.amountCents } };
    }
    case 'execute_transfer': {
      const draft = state.toolRecords.find(item => item.id === input.draftId && item.kind === 'transfer_draft');
      if (!draft) throw new Error('TRANSFER_DRAFT_NOT_FOUND');
      const inputHash = stableHash({ draftId: input.draftId, snapshotId: input.snapshotId });
      const replay = previousOperation(state, input.idempotencyKey, inputHash);
      if (replay) return { state, result: replay };
      if (draft.data.twinVersion !== state.twinVersion || draft.data.snapshotId !== input.snapshotId) throw new Error('TWIN_VERSION_CHANGED');
      let next = consumeApproval(state, input.approvalToken, 'execute_transfer', { draftId: input.draftId, snapshotId: input.snapshotId });
      const sourceId = String(draft.data.sourceAccountId), destinationId = String(draft.data.destinationAccountId), amountCents = Number(draft.data.amountCents);
      const source = account(next, sourceId), destination = account(next, destinationId);
      if (source.protected) throw new Error('PROTECTED_ACCOUNT');
      if (source.balanceCents < amountCents) throw new Error('INSUFFICIENT_BALANCE');
      if(source.type==='checking'&&source.balanceCents-amountCents<protectedCheckingReserve(next))throw new Error('PROTECTED_FUNDS_UNAVAILABLE');
      next = { ...next, twinVersion: next.twinVersion + 1,
        accounts: next.accounts.map(item => item.id === sourceId ? { ...item, balanceCents: item.balanceCents - amountCents }
          : item.id === destinationId ? { ...item, balanceCents: item.balanceCents + amountCents } : item),
        finance: sourceId === 'checking' ? { ...next.finance, checkingCents: next.finance.checkingCents - amountCents } : next.finance };
      next = updateRecord(next, draft.id, 'consumed');
      const operation = executedOperation(next, name, input.idempotencyKey, inputHash, amountCents);
      operation.receipt.twinVersion = next.twinVersion;
      operation.operation.receipt = operation.receipt;
      next = appendPipeline(operation.state, operation.operation.operationId, '模拟转账完成');
      return { state: next, result: { status: 'succeeded', operationId: operation.operation.operationId, receipt: operation.receipt } };
    }
    case 'get_operation_status': {
      const operation = state.operations.find(item => item.operationId === input.operationId);
      if (!operation) throw new Error('OPERATION_NOT_FOUND');
      return { state, result: operation };
    }
    case 'quote_fx': {
      if (input.fromCurrency === input.toCurrency) throw new Error('FX_PAIR_INVALID');
      const rate = input.fromCurrency === 'CNY' && input.toCurrency === 'JPY' ? 20 : 1;
      const item: ToolRecord = { id: randomUUID(), kind: 'fx_quote', status: 'active', expiresAt: endOfDay(state),
        data: { ...input, rate, outputCents: Math.round(input.amountCents * rate) } };
      return { state: record(state, item), result: { quoteId: item.id, rate, outputCents: item.data.outputCents, expiresAt: item.expiresAt } };
    }
    case 'prepare_fx_order': {
      const quote = state.toolRecords.find(item => item.id === input.quoteId && item.kind === 'fx_quote');
      if (!quote) throw new Error('FX_QUOTE_NOT_FOUND');
      if (!quote.expiresAt || quote.expiresAt <= todayTime(state)) throw new Error('FX_QUOTE_EXPIRED');
      const source = account(state, input.sourceAccountId); const destination = account(state, input.destinationAccountId);
      if (source.currency !== quote.data.fromCurrency || destination.currency !== quote.data.toCurrency) throw new Error('FX_ACCOUNT_CURRENCY_MISMATCH');
      if (source.protected) throw new Error('PROTECTED_ACCOUNT');
      if (source.balanceCents < Number(quote.data.amountCents)) throw new Error('INSUFFICIENT_BALANCE');
      const item: ToolRecord = { id: randomUUID(), kind: 'fx_draft', status: 'prepared', expiresAt: quote.expiresAt,
        data: { ...input, amountCents: quote.data.amountCents, outputCents: quote.data.outputCents, twinVersion: state.twinVersion } };
      return { state: record(state, item), result: { draftId: item.id, quoteId: quote.id, outputCents: quote.data.outputCents } };
    }
    case 'execute_fx_order': {
      const draft = state.toolRecords.find(item => item.id === input.draftId && item.kind === 'fx_draft');
      if (!draft) throw new Error('FX_DRAFT_NOT_FOUND');
      if (!draft.expiresAt || draft.expiresAt <= todayTime(state)) throw new Error('FX_QUOTE_EXPIRED');
      const inputHash = stableHash({ draftId: input.draftId, quoteId: input.quoteId });
      const replay = previousOperation(state, input.idempotencyKey, inputHash);
      if (replay) return { state, result: replay };
      if (draft.data.twinVersion !== state.twinVersion || draft.data.quoteId !== input.quoteId) throw new Error('TWIN_VERSION_CHANGED');
      let next = consumeApproval(state, input.approvalToken, 'execute_fx_order', { draftId: input.draftId, quoteId: input.quoteId });
      const sourceId = String(draft.data.sourceAccountId), destinationId = String(draft.data.destinationAccountId);
      const amountCents = Number(draft.data.amountCents), outputCents = Number(draft.data.outputCents);
      next = { ...next, twinVersion: next.twinVersion + 1,
        accounts: next.accounts.map(item => item.id === sourceId ? { ...item, balanceCents: item.balanceCents - amountCents }
          : item.id === destinationId ? { ...item, balanceCents: item.balanceCents + outputCents } : item),
        finance: sourceId === 'checking' ? { ...next.finance, checkingCents: next.finance.checkingCents - amountCents } : next.finance };
      next = updateRecord(next, draft.id, 'consumed');
      const operation = executedOperation(next, name, input.idempotencyKey, inputHash, amountCents);
      operation.receipt.twinVersion = next.twinVersion;
      operation.operation.receipt = operation.receipt;
      next = appendPipeline(operation.state, operation.operation.operationId, '模拟换汇完成');
      return { state: next, result: { status: 'succeeded', operationId: operation.operation.operationId, receipt: operation.receipt } };
    }
    case 'create_mandate': {
      if (state.goal.status !== 'active') throw new Error('GOAL_NOT_ACTIVE');
      if (input.totalLimitCents < input.maxPerOperationCents || input.expiresAt <= state.clock) throw new Error('INVALID_MANDATE');
      let next = consumeApproval(state, input.approvalToken, 'create_mandate', {
        agentId: input.agentId, category: input.category, maxPerOperationCents: input.maxPerOperationCents,
        totalLimitCents: input.totalLimitCents, expiresAt: input.expiresAt,
      });
      next = { ...next, mandate: { id: randomUUID(), goalId: next.goal.id, agentId: input.agentId,
        category: input.category, maxPerOperationCents: input.maxPerOperationCents, totalLimitCents: input.totalLimitCents,
        spentCents: 0, validFrom: next.clock, expiresAt: input.expiresAt, active: true, version: 1 } };
      next = appendAuditEvent(next, 'mandate_created', 'active', '版本化限定授权已创建');
      return { state: next, result: { mandateId: next.mandate!.id, version: 1, status: 'active' } };
    }
    case 'list_mandates': return { state, result: { mandates: state.mandate ? [state.mandate] : [] } };
    case 'update_mandate': {
      if (!state.mandate || state.mandate.id !== input.mandateId) throw new Error('MANDATE_NOT_FOUND');
      if (input.totalLimitCents < input.maxPerOperationCents || input.totalLimitCents < state.mandate.spentCents || input.expiresAt <= state.clock)
        throw new Error('INVALID_MANDATE');
      const parameters = { mandateId: input.mandateId, category: input.category,
        maxPerOperationCents: input.maxPerOperationCents, totalLimitCents: input.totalLimitCents, expiresAt: input.expiresAt };
      let next = consumeApproval(state, input.approvalToken, 'update_mandate', parameters);
      next = { ...next, twinVersion: next.twinVersion + 1, mandate: { ...state.mandate, ...parameters,
        version: state.mandate.version + 1 } };
      next = appendAuditEvent(next, 'mandate_updated', 'confirmed', '授权边界与版本已更新');
      return { state: next, result: { mandateId: input.mandateId, version: next.mandate!.version, status: next.mandate!.active ? 'active' : 'paused' } };
    }
    case 'pause_mandate':
    case 'revoke_mandate': {
      if (!state.mandate || state.mandate.id !== input.mandateId) throw new Error('MANDATE_NOT_FOUND');
      let next = consumeApproval(state, input.approvalToken, name, { mandateId: input.mandateId });
      next = { ...next, twinVersion: next.twinVersion + 1,
        mandate: { ...state.mandate, active: false, version: state.mandate.version + 1 } };
      next = appendAuditEvent(next, name === 'pause_mandate' ? 'mandate_paused' : 'mandate_revoked', 'confirmed', '授权状态已更新');
      return { state: next, result: { mandateId: input.mandateId, version: next.mandate!.version, status: name === 'pause_mandate' ? 'paused' : 'revoked' } };
    }
    case 'evaluate_external_request': {
      const evaluated = evaluateExternalRequest(state, {
        agentId: input.agentId, category: input.category, amountCents: input.amountCents,
        idempotencyKey: input.idempotencyKey, simulateTimeout: input.simulateTimeout,
      });
      return { state: evaluated.state, result: evaluated.operation };
    }
    case 'approve_external_operation': {
      let next = consumeApproval(state, input.approvalToken, 'approve_external_operation', { operationId: input.operationId });
      next = approveOperation(next, input.operationId);
      return { state: next, result: next.operations.find(item => item.operationId === input.operationId) };
    }
    case 'reconcile_operation': {
      const next = reconcileOperation(state, input.operationId);
      return { state: next, result: next.operations.find(item => item.operationId === input.operationId) };
    }
    case 'detect_financial_signals': return { state, result: { signals: state.pendingImpact ? [{ type: 'goal_impact', impact: state.pendingImpact }] : [] } };
    case 'explain_decision': {
      const operation = state.operations.find(item => item.operationId === input.operationId);
      if (!operation) throw new Error('OPERATION_NOT_FOUND');
      return { state, result: { operationId: operation.operationId, explanation: operation.reason } };
    }
    case 'get_activity': return { state, result: { events: state.audit.slice(-input.limit).reverse() } };
    case 'export_audit_report': {
      const chainValid = verifyAuditChain(state.audit);
      const content = input.format === 'json' ? JSON.stringify({ chainValid, events: state.audit }, null, 2)
        : ['sequence,at,action,outcome,detail,eventHash', ...state.audit.map(event =>
          [event.sequence, event.at, event.action, event.outcome, JSON.stringify(event.detail), event.eventHash].join(','))].join('\n');
      return { state, result: { format: input.format, chainValid, content } };
    }
  }
}
