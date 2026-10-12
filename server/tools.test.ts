import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixture } from './fixtures.ts';
import { activatePlan } from './domain.ts';
import { approveOperation, createMandate, evaluateExternalRequest, reconcileOperation, revokeMandate } from './tools.ts';

test('mandate requires confirmation and keeps the emergency fund isolated', () => {
  const state = activatePlan(createFixture(), 'balanced');
  assert.throws(() => createMandate(state, { confirmed: false }), /CONFIRMATION_REQUIRED/);
  const withMandate = createMandate(state, { confirmed: true });
  const result = evaluateExternalRequest(withMandate, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'trip-1' });
  assert.equal(result.operation.status, 'executed');
  assert.equal(result.state.finance.checkingCents, withMandate.finance.checkingCents - 30000);
  assert.equal(result.state.finance.emergencyCents, withMandate.finance.emergencyCents);
  const replay = evaluateExternalRequest(result.state, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'trip-1' });
  assert.equal(replay.state.finance.checkingCents, result.state.finance.checkingCents);
  assert.equal(replay.operation.operationId, result.operation.operationId);
});

test('shopping asks for approval and over-limit requests are blocked', () => {
  const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
  const ask = evaluateExternalRequest(state, { agentId: 'travel-agent-demo', category: 'shopping', amountCents: 20000, idempotencyKey: 'shop-1' });
  assert.equal(ask.operation.status, 'ask');
  assert.equal(ask.state.finance.checkingCents, state.finance.checkingCents);
  const approved = approveOperation(ask.state, ask.operation.operationId);
  assert.equal(approved.finance.checkingCents, state.finance.checkingCents - 20000);
  const blocked = evaluateExternalRequest(state, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 200000, idempotencyKey: 'trip-over-limit' });
  assert.equal(blocked.operation.status, 'blocked');
});

test('near-limit requests require manual review before execution', () => {
  const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
  const result = evaluateExternalRequest(state, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 40000, idempotencyKey: 'manual-1' });
  assert.equal(result.operation.status, 'manual_review');
  assert.equal(result.state.finance.checkingCents, state.finance.checkingCents);
});

test('timeout keeps status unknown and does not spend money on retry', () => {
  const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
  const input = { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'timeout-1', simulateTimeout: true };
  const first = evaluateExternalRequest(state, input);
  assert.equal(first.operation.status, 'unknown');
  const second = evaluateExternalRequest(first.state, input);
  assert.equal(second.operation.status, 'unknown');
  assert.equal(second.state.finance.checkingCents, state.finance.checkingCents);
  assert.throws(() => evaluateExternalRequest(first.state, { ...input, simulateTimeout: false }), /IDEMPOTENCY_CONFLICT/);
});

test('expired, insufficient balance and revoked mandates block writes', () => {
  const base = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
  const expired = { ...base, clock: '2027-01-01' };
  assert.equal(evaluateExternalRequest(expired, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'expired' }).operation.status, 'blocked');
  const poor = { ...base, finance: { ...base.finance, checkingCents: 1000 } };
  assert.equal(evaluateExternalRequest(poor, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'poor' }).operation.status, 'blocked');
  const revoked = revokeMandate(base);
  assert.equal(evaluateExternalRequest(revoked, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'revoked' }).operation.status, 'blocked');
});

test('approval consumes the mandate budget and a changed idempotent request is rejected', () => {
  const base = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
  const ask = evaluateExternalRequest(base, { agentId: 'travel-agent-demo', category: 'shopping', amountCents: 20000, idempotencyKey: 'shop-budget' });
  const approved = approveOperation(ask.state, ask.operation.operationId);
  assert.equal(approved.mandate?.spentCents, 20000);
  assert.throws(() => evaluateExternalRequest(approved, { agentId: 'travel-agent-demo', category: 'shopping', amountCents: 21000, idempotencyKey: 'shop-budget' }), /IDEMPOTENCY_CONFLICT/);
});

test('approval is bound to the original mandate and timeout can be reconciled', () => {
  const base = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
  const ask = evaluateExternalRequest(base, { agentId: 'travel-agent-demo', category: 'shopping', amountCents: 20000, idempotencyKey: 'ask-bound' });
  const replaced = createMandate(ask.state, { confirmed: true });
  assert.throws(() => approveOperation(replaced, ask.operation.operationId), /MANDATE_CHANGED/);
  const timeout = evaluateExternalRequest(base, { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000, idempotencyKey: 'reconcile', simulateTimeout: true });
  const recovered = reconcileOperation(timeout.state, timeout.operation.operationId);
  assert.equal(recovered.operations.at(-1)?.status, 'blocked');
  assert.equal(recovered.finance.checkingCents, base.finance.checkingCents);
});
