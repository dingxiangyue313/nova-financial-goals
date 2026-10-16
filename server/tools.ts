import type { DemoState, Mandate, Operation, Receipt } from '../shared/contracts.ts';
import { appendAuditEvent, stableHash } from './governance.ts';
import { decideAgentRequest } from './risk.ts';

export interface ExternalRequest {
  agentId: string; category: string; amountCents: number; idempotencyKey: string;
  simulateTimeout?: boolean;
}

function pipelineAudit(state: DemoState, operation: Operation): DemoState {
  let next = appendAuditEvent(state, 'request_received', 'received', '已收到外部 Agent 模拟请求', { operationId: operation.operationId });
  next = appendAuditEvent(next, 'permission', operation.status === 'blocked' ? 'blocked' : 'checked', '授权边界、Agent 身份与有效期检查', { operationId: operation.operationId });
  next = appendAuditEvent(next, 'risk', operation.status, operation.reason, { operationId: operation.operationId });
  if (operation.status === 'executed') {
    next = appendAuditEvent(next, 'user_confirmation', 'not_required', '授权范围内的低风险请求无需逐次确认', { operationId: operation.operationId });
    next = appendAuditEvent(next, 'execute', 'simulated', '模拟余额发生变化', { operationId: operation.operationId });
    next = appendAuditEvent(next, 'verify', 'confirmed', '已核对操作凭证与余额', { operationId: operation.operationId });
    next = appendAuditEvent(next, 'receipt', 'issued', `已签发 Receipt ${operation.receipt?.operationId ?? operation.operationId}`, { operationId: operation.operationId });
  }
  return operation.status === 'ask' || operation.status === 'manual_review' ? next
    : appendAuditEvent(next, 'audit', operation.status, '已记录不可变操作结果', { operationId: operation.operationId });
}

export function createMandate(state: DemoState, input: {
  confirmed: boolean; category?: string; maxPerOperationCents?: number;
  totalLimitCents?: number; expiresAt?: string;
}): DemoState {
  if (!input.confirmed) throw new Error('CONFIRMATION_REQUIRED');
  if (state.goal.status !== 'active') throw new Error('GOAL_NOT_ACTIVE');
  const category = input.category || 'transport';
  const maxPerOperationCents = input.maxPerOperationCents ?? 50000;
  const totalLimitCents = input.totalLimitCents ?? 120000;
  const expiresAt = input.expiresAt || '2026-12-31';
  if (!['transport', 'shopping'].includes(category) || !Number.isInteger(maxPerOperationCents) || maxPerOperationCents <= 0 ||
      !Number.isInteger(totalLimitCents) || totalLimitCents < maxPerOperationCents || expiresAt <= state.clock) throw new Error('INVALID_MANDATE');
  const mandate: Mandate = { id: crypto.randomUUID(), goalId: state.goal.id, category,
    maxPerOperationCents, totalLimitCents, spentCents: 0, expiresAt, active: true,
    version: 1, agentId: 'travel-agent-demo', validFrom: state.clock };
  return appendAuditEvent({ ...state, mandate, twinVersion: state.twinVersion + 1 }, 'create_mandate', 'confirmed', `${category} 授权额度已创建`);
}

export function evaluateExternalRequest(state: DemoState, request: ExternalRequest): { state: DemoState; operation: Operation } {
  if (!Number.isInteger(request.amountCents) || request.amountCents <= 0 || request.amountCents > 100000000 ||
      !request.idempotencyKey || request.idempotencyKey.length > 100) throw new Error('INVALID_REQUEST');
  const previous = state.operations.find(op => op.idempotencyKey === request.idempotencyKey);
  if (previous) {
    if ((previous.inputHash && previous.inputHash !== stableHash(request)) || previous.amountCents !== request.amountCents || previous.category !== request.category ||
      (previous.agentId && previous.agentId !== request.agentId)) throw new Error('IDEMPOTENCY_CONFLICT');
    return { state, operation: previous };
  }
  const mandate = state.mandate;
  const decision = decideAgentRequest(state, request);
  let status: Operation['status'] = decision.outcome === 'block' ? 'blocked'
    : decision.outcome === 'execute' ? 'executed' : decision.outcome as Operation['status'];
  let reason = decision.explanation;
  if (status === 'executed' && request.simulateTimeout) {
    status = 'unknown';
    reason = '模拟工具超时，状态未知；只能先查询原操作，不能重复扣款。';
  }
  const operationId = crypto.randomUUID();
  const receipt: Receipt | null = status === 'executed' ? { operationId, tool: 'external_payment', status: 'succeeded',
    amountCents: request.amountCents, currency: 'CNY', executedAt: `${state.clock}T12:00:00.000Z`, twinVersion: state.twinVersion + 1 } : null;
  const verificationRequirement: Operation['verificationRequirement'] = status === 'ask' ? 'quick_confirm'
    : status === 'manual_review' ? 'platform' : 'none';
  const verificationStatus: Operation['verificationStatus'] = verificationRequirement === 'none' ? 'not_required' : 'pending';
  const operation: Operation = { operationId, idempotencyKey: request.idempotencyKey,
    status, category: request.category, amountCents: request.amountCents, reason,
    originalDecision: status === 'executed' ? 'execute' : status === 'blocked' ? 'block'
      : status === 'unknown' ? 'unknown' : status,
    agentId: request.agentId, mandateId: mandate?.id ?? null,
    tool: 'external_payment', inputHash: stableHash(request), receipt,
    createdAt: `${state.clock}T12:00:00.000Z`, verificationRequirement, verificationStatus,
    balanceBeforeCents: state.finance.checkingCents,
    balanceAfterCents: status === 'executed' ? state.finance.checkingCents - request.amountCents : null,
    mandateSpentBeforeCents: mandate?.spentCents ?? null,
    mandateSpentAfterCents: status === 'executed' ? (mandate?.spentCents ?? 0) + request.amountCents : null,
    twinVersionBefore: state.twinVersion, twinVersionAfter: status === 'executed' ? state.twinVersion + 1 : null };
  let next: DemoState = { ...state, operations: [...state.operations, operation] };
  if (status === 'executed') {
    next.twinVersion = state.twinVersion + 1;
    next.finance = { ...state.finance, checkingCents: state.finance.checkingCents - request.amountCents,
      currentMonthExpenseCents: state.finance.currentMonthExpenseCents + request.amountCents,
      updatedAt: state.clock };
    next.accounts = state.accounts.map(item => item.id === 'checking' ? { ...item, balanceCents: item.balanceCents - request.amountCents } : item);
    next.transactions = [{ id: `agent-payment:${operationId}`, accountId: 'checking', date: state.clock,
      title: '外部 Agent 模拟支付', category: request.category, amountCents: -request.amountCents }, ...state.transactions];
    next.mandate = { ...mandate!, spentCents: mandate!.spentCents + request.amountCents };
    next.receipts = [...state.receipts, receipt!];
  }
  next = pipelineAudit(next, operation);
  return { state: next, operation: next.operations.at(-1)! };
}

export function approveOperation(state: DemoState, operationId: string, verification: 'quick_confirm' | 'platform' = 'quick_confirm'): DemoState {
  const index = state.operations.findIndex(op => op.operationId === operationId);
  if (index < 0) throw new Error('OPERATION_NOT_FOUND');
  const operation = state.operations[index];
  if (operation.status === 'executed') return state;
  if (operation.status !== 'ask' && operation.status !== 'manual_review') throw new Error('OPERATION_NOT_APPROVABLE');
  if (operation.status === 'manual_review' && verification !== 'platform') throw new Error('USER_VERIFICATION_REQUIRED');
  if (operation.amountCents > state.finance.checkingCents) throw new Error('INSUFFICIENT_BALANCE');
  if (!state.mandate || !state.mandate.active || state.mandate.expiresAt < state.clock) throw new Error('MANDATE_EXPIRED');
  if (operation.mandateId !== state.mandate.id || state.mandate.goalId !== state.goal.id ||
      operation.agentId !== 'travel-agent-demo' || state.goal.status !== 'active') throw new Error('MANDATE_CHANGED');
  if (operation.amountCents > state.mandate.maxPerOperationCents ||
      state.mandate.spentCents + operation.amountCents > state.mandate.totalLimitCents) throw new Error('MANDATE_LIMIT_EXCEEDED');
  const receipt: Receipt = { operationId, tool: 'external_payment', status: 'succeeded', amountCents: operation.amountCents,
    currency: 'CNY', executedAt: `${state.clock}T12:00:00.000Z`, twinVersion: state.twinVersion + 1 };
  const updated: Operation = { ...operation, status: 'executed', reason: verification === 'platform'
    ? '用户已完成设备验证；模拟操作完成。' : '用户已核对固定请求参数并逐次确认；模拟操作完成。', receipt,
    verificationStatus: 'verified', balanceAfterCents: state.finance.checkingCents - operation.amountCents,
    mandateSpentAfterCents: state.mandate.spentCents + operation.amountCents,
    twinVersionAfter: state.twinVersion + 1 };
  const operations = [...state.operations];
  operations[index] = updated;
  let next: DemoState = { ...state, operations, twinVersion: state.twinVersion + 1,
    finance: { ...state.finance, checkingCents: state.finance.checkingCents - operation.amountCents,
      currentMonthExpenseCents: state.finance.currentMonthExpenseCents + operation.amountCents,
      updatedAt: state.clock },
    accounts: state.accounts.map(item => item.id === 'checking' ? { ...item, balanceCents: item.balanceCents - operation.amountCents } : item),
    transactions: [{ id: `agent-payment:${operationId}`, accountId: 'checking', date: state.clock,
      title: '用户确认的外部 Agent 模拟支付', category: operation.category, amountCents: -operation.amountCents }, ...state.transactions],
    mandate: { ...state.mandate, spentCents: state.mandate.spentCents + operation.amountCents },
    receipts: [...state.receipts, receipt] };
  next = appendAuditEvent(next, 'user_confirmation', verification === 'platform' ? 'platform_verified' : 'confirmed', updated.reason, { operationId });
  next = appendAuditEvent(next, 'execute', 'simulated', '模拟余额发生变化', { operationId });
  next = appendAuditEvent(next, 'verify', 'confirmed', '已核对模拟余额与请求凭证', { operationId });
  next = appendAuditEvent(next, 'receipt', 'issued', `已签发 Receipt ${receipt.operationId}`, { operationId });
  return appendAuditEvent(next, 'audit', 'executed', '已记录不可变操作结果', { operationId });
}

export function revokeMandate(state: DemoState): DemoState {
  if (!state.mandate) throw new Error('MANDATE_NOT_FOUND');
  return appendAuditEvent({ ...state, twinVersion: state.twinVersion + 1,
    mandate: { ...state.mandate, active: false, version: state.mandate.version + 1 } },
  'revoke_mandate', 'confirmed', '用户撤销模拟授权');
}

export function reconcileOperation(state: DemoState, operationId: string): DemoState {
  const index = state.operations.findIndex(op => op.operationId === operationId);
  if (index < 0) throw new Error('OPERATION_NOT_FOUND');
  const operation = state.operations[index];
  if (operation.status !== 'unknown') return state;
  const updated: Operation = { ...operation, status: 'blocked', reason: '已核对模拟账本：原请求未执行、余额未变化。若需重试，请使用新的请求号。' };
  const operations = [...state.operations]; operations[index] = updated;
  return appendAuditEvent({ ...state, operations }, 'reconcile_operation', 'blocked', updated.reason, { operationId });
}

export function verifyOperation(state: DemoState, operationId: string): Operation {
  const operation = state.operations.find(op => op.operationId === operationId);
  if (!operation) throw new Error('OPERATION_NOT_FOUND');
  return operation;
}

export function quickConfirmOperation(state: DemoState, operationId: string): DemoState {
  const operation = verifyOperation(state, operationId);
  if (operation.status === 'manual_review') throw new Error('USER_VERIFICATION_REQUIRED');
  if (operation.status !== 'ask') throw new Error('OPERATION_NOT_APPROVABLE');
  if (!state.mandate || operation.mandateId !== state.mandate.id || operation.agentId !== state.mandate.agentId) {
    const operations = state.operations.map(item => item.operationId === operationId ? {
      ...item, status: 'blocked' as const,
      reason: 'MANDATE_CHANGED：授权范围已变化，旧请求已失效。请按当前授权重新发起。',
    } : item);
    return appendAuditEvent({ ...state, operations }, 'mandate_changed', 'blocked',
      '授权范围已变化，旧请求已失效', { operationId });
  }
  return approveOperation(state, operationId, 'quick_confirm');
}

export function retryOperation(state: DemoState, operationId: string): { state: DemoState; operation: Operation } {
  const previous = verifyOperation(state, operationId);
  if (!previous.reason.includes('MANDATE_CHANGED')) throw new Error('OPERATION_RETRY_NOT_ALLOWED');
  let next = appendAuditEvent(state, 'retry_requested', 'received', '用户按当前授权重新发起请求', { operationId });
  return evaluateExternalRequest(next, { agentId: previous.agentId ?? 'travel-agent-demo', category: previous.category,
    amountCents: previous.amountCents, idempotencyKey: crypto.randomUUID() });
}
