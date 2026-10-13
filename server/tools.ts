import type { DemoState, Mandate, Operation, Receipt } from '../shared/contracts.ts';
import { appendAuditEvent, stableHash } from './governance.ts';
import { decideAgentRequest } from './risk.ts';

export interface ExternalRequest {
  agentId: string; category: string; amountCents: number; idempotencyKey: string;
  simulateTimeout?: boolean;
}

function pipelineAudit(state: DemoState, operation: Operation): DemoState {
  let next = appendAuditEvent(state, 'permission', operation.status === 'blocked' ? 'blocked' : 'checked', '授权边界、Agent 身份与有效期检查', { operationId: operation.operationId });
  next = appendAuditEvent(next, 'risk', operation.status, operation.reason, { operationId: operation.operationId });
  if (operation.status === 'executed') {
    next = appendAuditEvent(next, 'execute', 'simulated', '模拟余额发生变化', { operationId: operation.operationId });
    next = appendAuditEvent(next, 'verify', 'confirmed', '已核对操作凭证与余额', { operationId: operation.operationId });
  }
  return appendAuditEvent(next, 'audit', operation.status, '已记录不可变操作结果', { operationId: operation.operationId });
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
  const operation: Operation = { operationId, idempotencyKey: request.idempotencyKey,
    status, category: request.category, amountCents: request.amountCents, reason,
    agentId: request.agentId, mandateId: mandate?.id ?? null,
    tool: 'external_payment', inputHash: stableHash(request), receipt };
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

export function approveOperation(state: DemoState, operationId: string): DemoState {
  const index = state.operations.findIndex(op => op.operationId === operationId);
  if (index < 0) throw new Error('OPERATION_NOT_FOUND');
  const operation = state.operations[index];
  if (operation.status === 'executed') return state;
  if (operation.status !== 'ask' && operation.status !== 'manual_review') throw new Error('OPERATION_NOT_APPROVABLE');
  if (operation.amountCents > state.finance.checkingCents) throw new Error('INSUFFICIENT_BALANCE');
  if (!state.mandate || !state.mandate.active || state.mandate.expiresAt < state.clock) throw new Error('MANDATE_EXPIRED');
  if (operation.mandateId !== state.mandate.id || state.mandate.goalId !== state.goal.id ||
      operation.agentId !== 'travel-agent-demo' || state.goal.status !== 'active') throw new Error('MANDATE_CHANGED');
  if (operation.amountCents > state.mandate.maxPerOperationCents ||
      state.mandate.spentCents + operation.amountCents > state.mandate.totalLimitCents) throw new Error('MANDATE_LIMIT_EXCEEDED');
  const receipt: Receipt = { operationId, tool: 'external_payment', status: 'succeeded', amountCents: operation.amountCents,
    currency: 'CNY', executedAt: `${state.clock}T12:00:00.000Z`, twinVersion: state.twinVersion + 1 };
  const updated: Operation = { ...operation, status: 'executed', reason: '用户已核对固定请求参数并逐次确认；模拟操作完成。', receipt };
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
  next = appendAuditEvent(next, 'approve_operation', 'executed', updated.reason, { operationId });
  return appendAuditEvent(next, 'verify', 'confirmed', '已核对模拟余额与请求凭证', { operationId });
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
