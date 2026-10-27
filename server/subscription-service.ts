import { randomUUID } from 'node:crypto';
import type { DemoState, Receipt, SubscriptionAction } from '../shared/contracts.ts';
import { appendAuditEvent, consumeApproval, createApprovalSnapshot } from './governance.ts';

function parameters(action: SubscriptionAction) {
  return { actionId: action.id, subscriptionId: action.subscriptionId, merchantId: action.merchantId, monthlyCents: action.monthlyCents, effectiveAt: action.effectiveAt, paidThrough: action.paidThrough };
}
export function prepareSubscriptionAction(state: DemoState, input: { subscriptionId: string; action: SubscriptionAction['action'] }) {
  const subscription = state.subscriptions.find(s => s.id === input.subscriptionId); if (!subscription) throw new Error('SUBSCRIPTION_NOT_FOUND');
  if (input.action === 'cancel' && state.subscriptionActions.some(a => a.subscriptionId === input.subscriptionId && a.status === 'unknown')) throw new Error('OPERATION_RECONCILE_FIRST');
  if (input.action === 'cancel' && subscription.status === 'cancelled') throw new Error('SUBSCRIPTION_ALREADY_CANCELLED');
  const effectiveAt = subscription.nextChargeDate;
  const paidThrough = new Date(Date.parse(`${effectiveAt}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const action: SubscriptionAction = { id: randomUUID(), ...input, merchantId: subscription.title === 'CloudBox Plus' ? 'cloudbox-plus' : subscription.id,
    status: input.action === 'cancel' ? 'awaiting_confirmation' : 'succeeded', monthlyCents: subscription.monthlyCents,
    effectiveAt, paidThrough, cancelledAt: null, nextChargeSuppressed: false, refundCents: 0, merchantOperationId: null,
    approvalId: null, snapshotHash: null, twinVersion: state.twinVersion, idempotencyKey: randomUUID(), receiptId: null };
  let next = state;
  if (input.action === 'cancel') {
    const prepared = createApprovalSnapshot(state, 'execute_subscription_cancellation', parameters(action), `${state.clock}T12:05:00.000Z`);
    next = prepared.state; action.approvalId = prepared.approval.id; action.snapshotHash = prepared.approval.snapshotHash;
  }
  return { state: { ...next, subscriptionActions: [...next.subscriptionActions, action] }, action };
}
function lookup(state: DemoState, id: string) { const action = state.subscriptionActions.find(a => a.id === id); if (!action) throw new Error('SUBSCRIPTION_ACTION_NOT_FOUND'); return action; }
function save(state: DemoState, action: SubscriptionAction) { return { ...state, subscriptionActions: state.subscriptionActions.map(a => a.id === action.id ? action : a) }; }
export function subscriptionSavingsEligible(state: DemoState, id: string) { const action = lookup(state,id); return ['succeeded','reconciled'].includes(action.status) && action.action === 'cancel' && action.nextChargeSuppressed; }

export function executeSubscriptionCancellation(state: DemoState, input: { actionId: string; approvalToken: string }, outcome: 'succeeded' | 'failed' | 'unknown' | 'unknown_committed' | 'requires_merchant' = 'succeeded'): { state: DemoState; action: SubscriptionAction; receipt: Receipt | null } {
  const original = lookup(state,input.actionId);
  if (['succeeded','reconciled','failed','requires_merchant','unknown'].includes(original.status)) return { state, action: original, receipt: state.receipts.find(r => r.operationId === original.receiptId) ?? null };
  if (original.action !== 'cancel' || original.status !== 'awaiting_confirmation') throw new Error('SUBSCRIPTION_ACTION_NOT_PENDING');
  if (original.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
  let next = consumeApproval(state,input.approvalToken,'execute_subscription_cancellation',parameters(original));
  const subscription = state.subscriptions.find(s => s.id === original.subscriptionId);
  if (!subscription || subscription.monthlyCents !== original.monthlyCents || subscription.nextChargeDate !== original.effectiveAt) throw new Error('SUBSCRIPTION_PREVIEW_STALE');
  next = appendAuditEvent(next,'permission','checked','用户已确认准确的订阅、金额、服务期限及取消后果',{ approvalId: original.approvalId! });
  next = appendAuditEvent(next,'risk','checked','仅关闭未来续费，不扣款、不退款');
  const committed = outcome === 'succeeded' || outcome === 'unknown_committed'; const verified = outcome === 'succeeded';
  const action: SubscriptionAction = { ...original, status: outcome === 'unknown_committed' ? 'unknown' : outcome, merchantOperationId: `merchant:${original.id}`, cancelledAt: verified ? `${state.clock}T12:00:00+08:00` : null, nextChargeSuppressed: verified, receiptId: original.id };
  const receipt: Receipt = { operationId: action.id, tool: 'execute_subscription_cancellation', status: verified ? 'succeeded' : outcome.startsWith('unknown') ? 'unknown' : 'failed', amountCents: 0, currency: 'CNY', executedAt: `${state.clock}T12:00:00+08:00`, twinVersion: state.twinVersion + 1 };
  next = { ...next, twinVersion: state.twinVersion + 1, subscriptions: state.subscriptions.map(s => s.id === action.subscriptionId && committed ? { ...s, status: 'cancelled' } : s),
    finance: { ...state.finance, fixedBillsCents: Math.max(0,state.finance.fixedBillsCents - (verified ? action.monthlyCents : 0)) }, receipts: [...state.receipts,receipt],
    mission: state.mission ? { ...state.mission, pending: null, subscription: { ...state.mission.subscription, status: committed ? 'cancelled' : outcome === 'unknown' ? 'unknown' : outcome === 'failed' ? 'failed' : 'active', cancelledAt: action.cancelledAt, effectiveAt: verified ? action.effectiveAt : null, nextChargeSuppressed: verified, merchantOperationId: action.merchantOperationId } } : undefined };
  next = save(next,action);
  for (const [stage, status] of [['execute',outcome],['verify',verified ? 'confirmed' : 'pending_or_failed'],['audit','recorded']]) next = appendAuditEvent(next,stage,status,verified ? '商户已验证关闭自动续费，保留服务至付费期结束。' : '未获得取消成功验证，不计入预测节省。',{ operationId: action.id });
  return { state: next, action, receipt };
}
export function reconcileSubscriptionCancellation(state: DemoState, actionId: string) {
  const original = lookup(state,actionId); if (original.status !== 'unknown') return { state,action: original };
  const committed = state.subscriptions.find(s => s.id === original.subscriptionId)?.status === 'cancelled';
  const action: SubscriptionAction = { ...original, status: 'reconciled', nextChargeSuppressed: committed, cancelledAt: committed ? `${state.clock}T12:00:00+08:00` : null };
  let next = save({ ...state,twinVersion: state.twinVersion + 1, finance: { ...state.finance, fixedBillsCents: Math.max(0,state.finance.fixedBillsCents - (committed ? action.monthlyCents : 0)) }, mission: state.mission ? { ...state.mission, subscription: { ...state.mission.subscription, status: committed ? 'cancelled' : 'active', nextChargeSuppressed: committed, cancelledAt: action.cancelledAt, effectiveAt: committed ? action.effectiveAt : null } } : undefined }, action);
  next = appendAuditEvent(next,'subscription_reconciliation',committed ? 'succeeded' : 'not_cancelled','已查询商户权威续费状态，没有重复提交取消。',{ operationId: action.id });
  return { state: next,action };
}
