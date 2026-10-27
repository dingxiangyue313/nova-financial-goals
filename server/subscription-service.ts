import { randomUUID } from 'node:crypto';
import { SubscriptionActionInputSchema, SubscriptionActionPreviewSchema, SubscriptionCancellationInputSchema,
  type DemoState, type Receipt, type SubscriptionAction, type SubscriptionActionPreview,
  type SubscriptionMerchant } from '../shared/contracts.ts';
import { appendAuditEvent, consumeApproval, stableHash } from './governance.ts';

const timestamp = (state: DemoState) => `${state.clock}T12:00:00.000Z`;
const previousDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

function subscription(state: DemoState, id: string) {
  const found = state.subscriptions.find(item => item.id === id);
  if (!found) throw new Error('SUBSCRIPTION_NOT_FOUND');
  return found;
}

function merchant(state: DemoState, subscriptionId: string): SubscriptionMerchant {
  const existing = state.subscriptionMerchants.find(item => item.subscriptionId === subscriptionId);
  if (existing) return existing;
  const item = subscription(state, subscriptionId);
  return { subscriptionId, merchantId: subscriptionId, monthlyCents: item.monthlyCents,
    paidThrough: previousDate(item.nextChargeDate), effectiveAt: item.nextChargeDate, renewalEnabled: true,
    cancellationBehavior: subscriptionId === 'cloudbox-plus' ? 'succeeded' : 'requires_merchant',
    status: 'active', operationId: null, cancelledAt: null };
}

export function subscriptionCancellationParameters(action: SubscriptionAction) {
  return { subscriptionId: action.subscriptionId, merchantId: action.merchantId, monthlyCents: action.monthlyCents,
    effectiveAt: action.effectiveAt, paidThrough: action.paidThrough, twinVersion: action.twinVersion,
    actionHash: action.actionHash };
}

function actionHash(action: SubscriptionAction) {
  const { actionHash: _hash, ...parameters } = subscriptionCancellationParameters(action);
  return stableHash({ id: action.id, action: action.action, ...parameters });
}

export function prepareSubscriptionAction(state: DemoState,
  raw: { subscriptionId: string; action: 'keep' | 'remind' | 'cancel' | 'not_subscription' }): SubscriptionActionPreview {
  const input = SubscriptionActionInputSchema.parse(raw);
  const item = subscription(state, input.subscriptionId);
  const history = state.subscriptionActions.filter(action => action.subscriptionId === item.id);
  if (input.action === 'cancel') {
    if (history.some(action => action.action === 'cancel' && ['unknown', 'executing'].includes(action.status)))
      throw new Error('SUBSCRIPTION_STATUS_REQUIRED');
    if (history.at(-1)?.action === 'not_subscription') throw new Error('SUBSCRIPTION_CLASSIFICATION_REJECTED');
    if (item.status === 'cancelled' || !merchant(state, item.id).renewalEnabled) throw new Error('SUBSCRIPTION_ALREADY_CANCELLED');
  }
  const terms = merchant(state, item.id);
  const action: SubscriptionAction = { id: randomUUID(), subscriptionId: item.id, merchantId: terms.merchantId,
    action: input.action, status: input.action === 'cancel' ? 'awaiting_confirmation' : 'succeeded',
    monthlyCents: item.monthlyCents, paidThrough: terms.paidThrough, effectiveAt: terms.effectiveAt,
    nextChargeSuppressed: false, refundCents: 0, twinVersion: state.twinVersion, actionHash: '',
    merchantOperationId: null, receiptOperationId: null,
    reminderAt: input.action === 'remind' ? previousDate(item.nextChargeDate) : null,
    evidenceRefs: [...new Set(state.billBriefs.flatMap(brief => brief.subscriptionCandidates
      .filter(candidate => candidate.subscriptionId === item.id).flatMap(candidate => candidate.sourceRefs)))],
    createdAt: timestamp(state), updatedAt: timestamp(state) };
  action.actionHash = actionHash(action);
  return SubscriptionActionPreviewSchema.parse({ action,
    approvalParameters: input.action === 'cancel' ? subscriptionCancellationParameters(action) : null,
    potentialMonthlySavingsCents: input.action === 'cancel' ? item.monthlyCents : 0,
    verifiedMonthlySavingsCents: 0,
    consequences: input.action === 'cancel'
      ? [`${item.title}：每月 ¥${(item.monthlyCents / 100).toFixed(2)}，下次续费 ${item.nextChargeDate}。`,
        `不退款；服务可使用至 ${terms.paidThrough}。商户验证成功后，${terms.effectiveAt} 起停止续费，预计每月可节省 ¥${(item.monthlyCents / 100).toFixed(2)}。`]
      : [input.action === 'keep' ? '保留服务与续费。' : input.action === 'remind'
        ? `续费前 ${action.reminderAt} 提醒核对，不取消服务。` : '已标记为非订阅，不继续准备取消。'] });
}

function storedAction(state: DemoState, id: string, cancellationOnly = true) {
  const found = state.subscriptionActions.find(item => item.id === id);
  if (!found) throw new Error('SUBSCRIPTION_ACTION_NOT_FOUND');
  if (cancellationOnly && found.action !== 'cancel') throw new Error('SUBSCRIPTION_NOT_CANCELLATION');
  if (found.actionHash !== actionHash(found)) throw new Error('SUBSCRIPTION_ACTION_CHANGED');
  return found;
}

function matchingTerms(action: SubscriptionAction, item: SubscriptionMerchant) {
  return item.subscriptionId === action.subscriptionId && item.merchantId === action.merchantId
    && item.monthlyCents === action.monthlyCents && item.paidThrough === action.paidThrough && item.effectiveAt === action.effectiveAt;
}

function saveAction(state: DemoState, action: SubscriptionAction): DemoState {
  return { ...state, subscriptionActions: state.subscriptionActions.map(item => item.id === action.id ? action : item) };
}

/** An explicit local choice authorizes only recording that choice, never a merchant request. */
export function persistSubscriptionDecision(state: DemoState, decision: SubscriptionAction, requestId = decision.id): DemoState {
  const previous = state.subscriptionActions.find(item => item.id === decision.id);
  if (decision.actionHash !== actionHash(decision)) throw new Error('SUBSCRIPTION_ACTION_CHANGED');
  if (decision.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  subscription(state, decision.subscriptionId);
  if (decision.action === 'cancel') {
    if (!previous || previous.status !== 'awaiting_confirmation' || decision.status !== 'cancelled'
      || previous.actionHash !== decision.actionHash) throw new Error('SUBSCRIPTION_ACTION_NOT_PENDING');
  } else if (previous || decision.status !== 'succeeded') throw new Error('SUBSCRIPTION_ACTION_NOT_PENDING');
  const label = decision.action === 'keep' ? '保留订阅' : decision.action === 'remind' ? '续费提醒'
    : decision.action === 'not_subscription' ? '这不是订阅' : '拒绝取消';
  const links = { operationId: decision.id, requestId };
  let next = appendAuditEvent(state, 'permission', 'checked', `用户明确选择${label}，仅授权保存本地决定。`, links);
  next = appendAuditEvent(next, 'risk', 'checked', '已核对决定与当前版本，不提交商户请求或改变续费和资金。', links);
  next = { ...next, twinVersion: state.twinVersion + 1,
    subscriptionActions: previous ? next.subscriptionActions.map(item => item.id === decision.id ? decision : item)
      : [...next.subscriptionActions, decision] };
  next = appendAuditEvent(next, 'execute', decision.status, `已保存用户的${label}决定。`, links);
  if (stableHash(next.subscriptionActions.find(item => item.id === decision.id)) !== stableHash(decision)
    || next.subscriptionMerchants !== state.subscriptionMerchants || next.subscriptions !== state.subscriptions
    || next.finance !== state.finance || next.receipts !== state.receipts || next.approvals !== state.approvals)
    throw new Error('SUBSCRIPTION_VERIFY_MISMATCH');
  next = appendAuditEvent(next, 'verify', decision.status, '本地决定已核对，商户、续费、余额与批准保持不变。', links);
  return appendAuditEvent(next, 'audit', 'recorded', `用户的${label}决定已记录。`, links);
}

function cancellationAuditLinks(state: DemoState, action: SubscriptionAction, operationId = action.merchantOperationId) {
  const authorization = state.approvals.find(item => item.status === 'consumed'
    && item.action === 'execute_subscription_cancellation'
    && stableHash(item.parameters) === stableHash(subscriptionCancellationParameters(action)));
  return { operationId: operationId ?? undefined, requestId: action.id, approvalId: authorization?.id };
}

/** The simulator alone writes renewalEnabled and the merchant operation ID. A timeout can hide an applied result. */
function cancelAtMerchant(state: DemoState, current: SubscriptionMerchant, operationId: string): { state: DemoState; merchant: SubscriptionMerchant; status: SubscriptionAction['status'] } {
  const mode = current.cancellationBehavior;
  const cancelled = mode === 'succeeded' || mode === 'unknown';
  const result: SubscriptionMerchant = { ...current, operationId, renewalEnabled: !cancelled,
    status: cancelled ? 'cancelled' : mode === 'pending' ? 'pending' : mode,
    cancelledAt: cancelled ? timestamp(state) : null };
  return { state: { ...state, subscriptionMerchants: [...state.subscriptionMerchants.filter(item =>
    item.subscriptionId !== result.subscriptionId), result] }, merchant: result,
    status: mode === 'pending' ? 'unknown' : mode };
}

function verifySuccess(state: DemoState, action: SubscriptionAction, authoritative: SubscriptionMerchant,
  status: 'succeeded' | 'reconciled'): { state: DemoState; action: SubscriptionAction; receipt: Receipt } {
  if (!matchingTerms(action, authoritative) || authoritative.renewalEnabled || authoritative.status !== 'cancelled'
    || !authoritative.operationId || !authoritative.cancelledAt || authoritative.operationId !== action.merchantOperationId)
    throw new Error('SUBSCRIPTION_VERIFY_MISMATCH');
  const receipt: Receipt = { operationId: action.receiptOperationId ?? randomUUID(),
    tool: 'execute_subscription_cancellation', status: 'succeeded', currency: 'CNY',
    executedAt: timestamp(state), twinVersion: state.twinVersion,
    merchantOperationId: authoritative.operationId, cancelledAt: authoritative.cancelledAt,
    paidThrough: authoritative.paidThrough, effectiveAt: authoritative.effectiveAt,
    nextChargeSuppressed: true, refundCents: 0 };
  const verified: SubscriptionAction = { ...action, status, nextChargeSuppressed: true,
    receiptOperationId: receipt.operationId, updatedAt: timestamp(state) };
  let next = saveAction({ ...state, subscriptions: state.subscriptions.map(item => item.id === action.subscriptionId
    ? { ...item, status: 'cancelled' as const } : item),
    receipts: state.receipts.some(item => item.operationId === receipt.operationId) ? state.receipts : [...state.receipts, receipt] }, verified);
  const links = cancellationAuditLinks(state, action);
  next = appendAuditEvent(next, 'verify', status, '已核对商户操作与停止续费结果；不退款，保留付费期服务。', links);
  next = appendAuditEvent(next, 'audit', 'recorded', '订阅处理结果与凭证已记录。', links);
  return { state: next, action: verified, receipt };
}

export function executeSubscriptionCancellation(state: DemoState, raw: { actionId: string; approvalToken: string }):
  { state: DemoState; action: SubscriptionAction; receipt: Receipt | null } {
  const input = SubscriptionCancellationInputSchema.parse(raw);
  const action = storedAction(state, input.actionId);
  if (action.status !== 'awaiting_confirmation') {
    const authorization = state.approvals.find(item => item.token === input.approvalToken && item.status === 'consumed'
      && item.action === 'execute_subscription_cancellation'
      && stableHash(item.parameters) === stableHash(subscriptionCancellationParameters(action)));
    if (!authorization) throw new Error('APPROVAL_TOKEN_INVALID');
    if (action.status === 'unknown' || action.status === 'executing') throw new Error('SUBSCRIPTION_STATUS_REQUIRED');
    if (!['succeeded', 'reconciled', 'failed', 'requires_merchant'].includes(action.status)) throw new Error('SUBSCRIPTION_ACTION_NOT_PENDING');
    return { state, action, receipt: state.receipts.find(item => item.operationId === action.receiptOperationId) ?? null };
  }
  if (action.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  if (state.subscriptionActions.filter(item => item.subscriptionId === action.subscriptionId).at(-1)?.action === 'not_subscription')
    throw new Error('SUBSCRIPTION_CLASSIFICATION_REJECTED');
  const item = subscription(state, action.subscriptionId); const terms = merchant(state, action.subscriptionId);
  if (!matchingTerms(action, terms) || item.monthlyCents !== action.monthlyCents || item.nextChargeDate !== action.effectiveAt)
    throw new Error('SUBSCRIPTION_TERMS_CHANGED');
  if (item.status !== 'active' || !terms.renewalEnabled) throw new Error('SUBSCRIPTION_ALREADY_CANCELLED');
  if (state.subscriptionActions.some(other => other.id !== action.id && other.subscriptionId === item.id
    && ['unknown', 'executing'].includes(other.status))) throw new Error('SUBSCRIPTION_STATUS_REQUIRED');
  let next = consumeApproval(state, input.approvalToken, 'execute_subscription_cancellation', subscriptionCancellationParameters(action));
  const operationId = randomUUID();
  const links = cancellationAuditLinks(next, action, operationId);
  next = appendAuditEvent(next, 'permission', 'checked', '用户已确认本次订阅的准确取消参数。', links);
  next = appendAuditEvent(next, 'risk', 'checked', '商户、金额、付费期、版本和取消状态已核对。', links);
  const executed = cancelAtMerchant(next, terms, operationId);
  next = { ...executed.state, twinVersion: state.twinVersion + 1 };
  const updated: SubscriptionAction = { ...action, status: executed.status,
    merchantOperationId: executed.merchant.operationId, updatedAt: timestamp(next) };
  next = saveAction(next, updated);
  next = appendAuditEvent(next, 'execute', updated.status, '已提交模拟商户取消请求。', links);
  if (updated.status === 'succeeded') return verifySuccess(next, updated, executed.merchant, 'succeeded');
  next = appendAuditEvent(next, 'verify', updated.status, updated.status === 'unknown'
    ? '尚未确认结果，保留预计续费；请先查询商户状态。' : '未验证到停止续费，保留预计续费。', links);
  next = appendAuditEvent(next, 'audit', 'recorded', '处理结果已记录，尚无已验证节省。', links);
  return { state: next, action: updated, receipt: null };
}

export function reconcileSubscriptionCancellation(state: DemoState, actionId: string): { state: DemoState; action: SubscriptionAction } {
  const action = storedAction(state, actionId, false);
  if (action.status !== 'unknown') return { state, action };
  const authoritative = state.subscriptionMerchants.find(item => item.subscriptionId === action.subscriptionId
    && item.operationId === action.merchantOperationId);
  if (!authoritative) throw new Error('SUBSCRIPTION_MERCHANT_OPERATION_NOT_FOUND');
  if (!matchingTerms(action, authoritative)) throw new Error('SUBSCRIPTION_TERMS_CHANGED');
  if (authoritative.status === 'pending') return { state, action };
  let next = { ...state, twinVersion: state.twinVersion + 1 };
  if (authoritative.status === 'cancelled') {
    const verified = verifySuccess(next, action, authoritative, 'reconciled');
    return { state: verified.state, action: verified.action };
  }
  const updated: SubscriptionAction = { ...action, status: authoritative.status === 'requires_merchant' ? 'requires_merchant' : 'failed',
    nextChargeSuppressed: false, updatedAt: timestamp(state) };
  const links = cancellationAuditLinks(state, action);
  next = appendAuditEvent(saveAction(next, updated), 'verify', updated.status, '商户状态查询确认尚未停止续费。', links);
  next = appendAuditEvent(next, 'audit', 'recorded', '原取消请求的商户核对结果已记录，未重复提交或计入节省。', links);
  return { state: next, action: updated };
}

/** Forecasts must use this verified gate; a local cancelled flag or prepared preview is insufficient. */
export function subscriptionSavingsEligible(state: DemoState, actionId: string): boolean {
  const action = state.subscriptionActions.find(item => item.id === actionId);
  if (!action || action.action !== 'cancel' || !['succeeded', 'reconciled'].includes(action.status)
    || !action.nextChargeSuppressed || action.actionHash !== actionHash(action)) return false;
  const authoritative = state.subscriptionMerchants.find(item => item.subscriptionId === action.subscriptionId);
  const item = state.subscriptions.find(item => item.id === action.subscriptionId);
  return Boolean(authoritative && item && item.monthlyCents === action.monthlyCents && matchingTerms(action, authoritative)
    && authoritative.operationId === action.merchantOperationId && authoritative.status === 'cancelled'
    && !authoritative.renewalEnabled && authoritative.cancelledAt);
}
