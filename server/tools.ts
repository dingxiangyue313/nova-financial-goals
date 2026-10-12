import type { Audit, DemoState, Mandate, Operation } from '../shared/contracts.ts';

export interface ExternalRequest {
  agentId: string; category: string; amountCents: number; idempotencyKey: string;
  simulateTimeout?: boolean;
}

function audit(state: DemoState, action: string, outcome: string, detail: string, operationId?: string): Audit[] {
  return [...state.audit, { id: crypto.randomUUID(), at: `${state.clock}T12:00:00Z`, action, outcome, detail, ...(operationId ? { operationId } : {}) }];
}

function pipelineAudit(state: DemoState, operation: Operation): Audit[] {
  const make = (action: string, outcome: string, detail: string): Audit => ({
    id: crypto.randomUUID(), at: `${state.clock}T12:00:00Z`, action, outcome, detail,
    operationId: operation.operationId,
  });
  return [...state.audit,
    make('permission', operation.status === 'blocked' ? 'blocked' : 'checked', '授权边界、Agent 身份与有效期检查'),
    make('risk', operation.status, operation.reason),
    ...(operation.status === 'executed' ? [make('execute', 'simulated', '模拟余额发生变化'), make('verify', 'confirmed', '已核对操作凭证与余额')] : []),
    make('audit', operation.status, '已记录不可变操作结果')];
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
  return { ...state, mandate, audit: audit(state, 'create_mandate', 'confirmed', `${category} 授权额度已创建`) };
}

export function evaluateExternalRequest(state: DemoState, request: ExternalRequest): { state: DemoState; operation: Operation } {
  if (!Number.isInteger(request.amountCents) || request.amountCents <= 0 || request.amountCents > 100000000 ||
      !request.idempotencyKey || request.idempotencyKey.length > 100) throw new Error('INVALID_REQUEST');
  const previous = state.operations.find(op => op.idempotencyKey === request.idempotencyKey);
  if (previous) {
    if (previous.amountCents !== request.amountCents || previous.category !== request.category ||
      (previous.agentId && previous.agentId !== request.agentId)) throw new Error('IDEMPOTENCY_CONFLICT');
    return { state, operation: previous };
  }
  const mandate = state.mandate;
  let status: Operation['status'] = 'blocked';
  let reason = '';
  if (request.agentId !== 'travel-agent-demo') reason = '外部 Agent 身份未通过验证，模拟请求被阻断。';
  else if (state.goal.status !== 'active') reason = '目标计划尚未激活。';
  else if (request.amountCents > state.finance.checkingCents) reason = '模拟活期余额不足；应急金保持隔离。';
  else if (!mandate || !mandate.active || mandate.expiresAt < state.clock) reason = '授权缺失或已过期。';
  else if (request.amountCents > mandate.maxPerOperationCents || mandate.spentCents + request.amountCents > mandate.totalLimitCents)
    reason = '请求超出授权额度，已阻断。';
  else if (request.category !== mandate.category) { status = 'ask'; reason = '用途与授权类别不同，需要你逐次确认。'; }
  else if (request.simulateTimeout) { status = 'unknown'; reason = '模拟工具超时，状态未知；只能先查询原操作，不能重复扣款。'; }
  else { status = 'executed'; reason = '模拟操作已完成；金额、授权和安全线已由服务端核对。'; }
  const operation: Operation = { operationId: crypto.randomUUID(), idempotencyKey: request.idempotencyKey,
    status, category: request.category, amountCents: request.amountCents, reason,
    agentId: request.agentId, mandateId: mandate?.id ?? null,
    tool: 'external_payment', receipt: null };
  const next: DemoState = { ...state, operations: [...state.operations, operation],
    audit: pipelineAudit(state, operation) };
  if (status === 'executed') {
    next.finance = { ...state.finance, checkingCents: state.finance.checkingCents - request.amountCents };
    next.mandate = { ...mandate!, spentCents: mandate!.spentCents + request.amountCents };
  }
  return { state: next, operation };
}

export function approveOperation(state: DemoState, operationId: string): DemoState {
  const index = state.operations.findIndex(op => op.operationId === operationId);
  if (index < 0) throw new Error('OPERATION_NOT_FOUND');
  const operation = state.operations[index];
  if (operation.status === 'executed') return state;
  if (operation.status !== 'ask') throw new Error('OPERATION_NOT_APPROVABLE');
  if (operation.amountCents > state.finance.checkingCents) throw new Error('INSUFFICIENT_BALANCE');
  if (!state.mandate || !state.mandate.active || state.mandate.expiresAt < state.clock) throw new Error('MANDATE_EXPIRED');
  if (operation.mandateId !== state.mandate.id || state.mandate.goalId !== state.goal.id ||
      operation.agentId !== 'travel-agent-demo' || state.goal.status !== 'active') throw new Error('MANDATE_CHANGED');
  if (operation.amountCents > state.mandate.maxPerOperationCents ||
      state.mandate.spentCents + operation.amountCents > state.mandate.totalLimitCents) throw new Error('MANDATE_LIMIT_EXCEEDED');
  const updated: Operation = { ...operation, status: 'executed', reason: '用户已核对固定请求参数并逐次确认；模拟操作完成。' };
  const operations = [...state.operations];
  operations[index] = updated;
  return { ...state, operations,
    finance: { ...state.finance, checkingCents: state.finance.checkingCents - operation.amountCents },
    mandate: { ...state.mandate, spentCents: state.mandate.spentCents + operation.amountCents },
    audit: [...audit(state, 'approve_operation', 'executed', updated.reason, operationId),
      { id: crypto.randomUUID(), at: `${state.clock}T12:00:00Z`, action: 'verify', outcome: 'confirmed', detail: '已核对模拟余额与请求凭证', operationId }] };
}

export function revokeMandate(state: DemoState): DemoState {
  if (!state.mandate) throw new Error('MANDATE_NOT_FOUND');
  return { ...state, mandate: { ...state.mandate, active: false },
    audit: audit(state, 'revoke_mandate', 'confirmed', '用户撤销模拟授权') };
}

export function reconcileOperation(state: DemoState, operationId: string): DemoState {
  const index = state.operations.findIndex(op => op.operationId === operationId);
  if (index < 0) throw new Error('OPERATION_NOT_FOUND');
  const operation = state.operations[index];
  if (operation.status !== 'unknown') return state;
  const updated: Operation = { ...operation, status: 'blocked', reason: '已核对模拟账本：原请求未执行、余额未变化。若需重试，请使用新的请求号。' };
  const operations = [...state.operations]; operations[index] = updated;
  return { ...state, operations, audit: audit(state, 'reconcile_operation', 'blocked', updated.reason, operationId) };
}

export function verifyOperation(state: DemoState, operationId: string): Operation {
  const operation = state.operations.find(op => op.operationId === operationId);
  if (!operation) throw new Error('OPERATION_NOT_FOUND');
  return operation;
}
