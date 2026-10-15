import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { runBankingTool } from './banking.ts';
import { activatePlan } from './domain.ts';
import { createFixture } from './fixtures.ts';
import { appendAuditEvent, verifyAuditChain } from './governance.ts';
import { analyzeSpendingPattern, decideAgentRequest } from './risk.ts';
import { createMandate, evaluateExternalRequest } from './tools.ts';

test('property: monetary calculations remain integer cents', () => {
  fc.assert(fc.property(
    fc.array(fc.integer({ min: 1, max: 200_000 }), { minLength: 3, maxLength: 20 }),
    (amounts) => {
      const current = amounts.map((amount, index) => ({ id: `current-${index}`, accountId: 'checking',
        date: `2026-09-${String(Math.min(21, index + 1)).padStart(2, '0')}`, title: '目标相关支出',
        category: 'delivery_and_rides', amountCents: -amount }));
      const history = [
        { id: 'older', accountId: 'checking', date: '2026-07-01', title: '历史支出', category: 'delivery_and_rides', amountCents: -30_000 },
        { id: 'previous', accountId: 'checking', date: '2026-08-01', title: '历史支出', category: 'delivery_and_rides', amountCents: -30_000 },
      ];
      const pattern = analyzeSpendingPattern([...current, ...history], 'delivery_and_rides', '2026-09-21');
      assert.ok(pattern);
      for (const value of [pattern.currentCents, pattern.baselineCents, pattern.increaseCents, pattern.increaseRatioBps])
        assert.equal(Number.isInteger(value), true);
    },
  ), { numRuns: 100 });
});

test('property: safe Agent payments preserve protected funds and idempotency', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 30_000 }), (amountCents) => {
    const base = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
    const request = { agentId: 'travel-agent-demo', category: 'transport', amountCents,
      idempotencyKey: `safe-${amountCents}` };
    const first = evaluateExternalRequest(base, request);
    assert.equal(first.operation.status, 'executed');
    assert.equal(first.state.finance.checkingCents, base.finance.checkingCents - amountCents);
    assert.equal(first.state.finance.emergencyCents, base.finance.emergencyCents);
    const replay = evaluateExternalRequest(first.state, request);
    assert.equal(replay.operation.operationId, first.operation.operationId);
    assert.equal(replay.state.finance.checkingCents, first.state.finance.checkingCents);
    assert.equal(replay.state.transactions.length, first.state.transactions.length);
  }), { numRuns: 100 });
});

test('property: stale Financial Twin versions cannot execute transfers', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 100_000 }), (amountCents) => {
    const base = activatePlan(createFixture(), 'balanced');
    const prepared = runBankingTool(base, 'prepare_transfer', {
      sourceAccountId: 'checking', destinationAccountId: 'goal-wallet', amountCents,
    });
    assert.throws(() => runBankingTool({ ...prepared.state, twinVersion: prepared.state.twinVersion + 1 }, 'execute_transfer', {
      draftId: prepared.result.draftId, snapshotId: prepared.result.snapshotId,
      approvalToken: 'never-used', idempotencyKey: `stale-${amountCents}`,
    }), /TWIN_VERSION_CHANGED/);
  }), { numRuns: 100 });
});

test('property: risk policy keeps Block before Ask, Manual Review, and Execute', () => {
  fc.assert(fc.property(fc.integer({ min: 1, max: 2_000_000 }), (amountCents) => {
    const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
    assert.equal(decideAgentRequest(state, { agentId: 'unknown-agent', category: 'shopping', amountCents }).outcome, 'block');
  }), { numRuns: 100 });

  fc.assert(fc.property(fc.integer({ min: 50_001, max: 2_000_000 }), (amountCents) => {
    const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
    assert.equal(decideAgentRequest(state, { agentId: 'travel-agent-demo', category: 'shopping', amountCents }).outcome, 'block');
  }), { numRuns: 100 });

  fc.assert(fc.property(fc.integer({ min: 1, max: 39_999 }), (amountCents) => {
    const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
    assert.equal(decideAgentRequest(state, { agentId: 'travel-agent-demo', category: 'shopping', amountCents }).outcome, 'ask');
  }), { numRuns: 100 });

  fc.assert(fc.property(fc.integer({ min: 40_000, max: 50_000 }), (amountCents) => {
    const state = createMandate(activatePlan(createFixture(), 'balanced'), { confirmed: true });
    assert.equal(decideAgentRequest(state, { agentId: 'travel-agent-demo', category: 'transport', amountCents }).outcome, 'manual_review');
  }), { numRuns: 100 });
});

test('property: every appended write preserves the audit hash chain', () => {
  fc.assert(fc.property(
    fc.array(fc.record({ action: fc.string({ minLength: 1, maxLength: 24 }),
      outcome: fc.string({ minLength: 1, maxLength: 24 }), detail: fc.string({ maxLength: 80 }) }),
    { minLength: 1, maxLength: 30 }),
    (events) => {
      const state = events.reduce((current, event) => appendAuditEvent(current, event.action, event.outcome, event.detail), createFixture());
      assert.equal(verifyAuditChain(state.audit), true);
    },
  ), { numRuns: 100 });
});
