import assert from 'node:assert/strict';
import test from 'node:test';
import { activatePlan } from './domain.ts';
import { createFixture } from './fixtures.ts';
import {
  DEFAULT_RISK_PREFERENCES,
  applySpendingTrendDemo,
  analyzeSpendingPattern,
  decideAgentRequest,
  evaluateOneOffExpenseRisk,
  evaluateSpendingRisk,
  markActiveRiskSignal,
} from './risk.ts';
import type { Transaction } from '../shared/contracts.ts';

function expense(id: string, date: string, amountYuan: number): Transaction {
  return { id, accountId: 'checking', date, title: '外卖与打车',
    category: 'delivery_and_rides', amountCents: -amountYuan * 100 };
}

const trendTransactions = [
  expense('old-1', '2026-06-28', 300), expense('old-2', '2026-07-12', 300),
  expense('previous-1', '2026-07-28', 300), expense('previous-2', '2026-08-12', 300),
  expense('current-1', '2026-08-25', 400), expense('current-2', '2026-09-02', 400),
  expense('current-3', '2026-09-09', 400), expense('current-4', '2026-09-15', 350),
  expense('current-5', '2026-09-21', 350),
];

test('pattern analyzer compares the current 30 days with two complete 30-day windows', () => {
  const pattern = analyzeSpendingPattern(trendTransactions, 'delivery_and_rides', '2026-09-21');
  assert.ok(pattern);
  assert.equal(pattern.currentCents, 190000);
  assert.equal(pattern.baselineCents, 60000);
  assert.equal(pattern.increaseCents, 130000);
  assert.equal(pattern.increaseRatioBps, 21667);
  assert.equal(pattern.transactionCount, 5);
  assert.deepEqual(pattern.evidenceTransactionIds, ['current-1', 'current-2', 'current-3', 'current-4', 'current-5']);
  assert.equal(pattern.confidence, 'high');
});

test('pattern analyzer withholds conclusions without two prior windows or reliable categories', () => {
  const incomplete = trendTransactions.filter(item => item.date >= '2026-07-24');
  assert.equal(analyzeSpendingPattern(incomplete, 'delivery_and_rides', '2026-09-21'), null);
  const uncertain = analyzeSpendingPattern(trendTransactions, 'delivery_and_rides', '2026-09-21', 0.5);
  assert.ok(uncertain);
  assert.equal(uncertain.confidence, 'low');
});

test('cumulative small transactions stay quiet until the goal worsens, then emit one immediate signal', () => {
  const active = activatePlan(createFixture(), 'balanced');
  const beforeLast = analyzeSpendingPattern(trendTransactions.slice(0, -1), 'delivery_and_rides', active.clock);
  assert.ok(beforeLast);
  assert.equal(evaluateSpendingRisk(active, beforeLast, DEFAULT_RISK_PREFERENCES).outcome, 'weekly_summary');

  const complete = analyzeSpendingPattern(trendTransactions, 'delivery_and_rides', active.clock);
  assert.ok(complete);
  const decision = evaluateSpendingRisk(active, complete, DEFAULT_RISK_PREFERENCES);
  assert.equal(decision.outcome, 'immediate_signal');
  assert.equal(decision.goalImpact?.beforeStatus, 'on_track');
  assert.equal(decision.goalImpact?.afterStatus, 'at_risk');
  assert.equal(decision.goalImpact?.delayDays, 16);
  assert.equal(decision.goalImpact?.safetyBufferAffected, false);
});

test('stale or uncertain data never produces an immediate consumer risk conclusion', () => {
  const active = activatePlan(createFixture(), 'balanced');
  const pattern = analyzeSpendingPattern(trendTransactions, 'delivery_and_rides', active.clock, 0.5);
  assert.ok(pattern);
  assert.equal(evaluateSpendingRisk(active, pattern, DEFAULT_RISK_PREFERENCES).outcome, 'weekly_summary');
  const stale = { ...active, finance: { ...active.finance, updatedAt: '2026-08-01' } };
  const reliable = analyzeSpendingPattern(trendTransactions, 'delivery_and_rides', active.clock);
  assert.ok(reliable);
  assert.equal(evaluateSpendingRisk(stale, reliable, DEFAULT_RISK_PREFERENCES).outcome, 'weekly_summary');
});

test('user card spending is observed rather than blocked, and only material goal impact is immediate', () => {
  const active = activatePlan(createFixture(), 'balanced');
  assert.equal(evaluateOneOffExpenseRisk(active, 1000).outcome, 'silent');
  const material = evaluateOneOffExpenseRisk(active, 90000);
  assert.equal(material.outcome, 'immediate_signal');
  assert.equal(material.goalImpact?.afterStatus, 'at_risk');
  assert.notEqual(material.outcome, 'block');
});

test('agent policy applies hard blocks, safe confirmation, manual review, and execution in order', () => {
  const active = activatePlan(createFixture(), 'balanced');
  const mandate = {
    id: 'mandate-1', goalId: active.goal.id, category: 'transport', maxPerOperationCents: 50000,
    totalLimitCents: 120000, spentCents: 0, expiresAt: '2026-12-31', active: true,
    version: 1, agentId: 'travel-agent-demo', validFrom: active.clock,
  };
  const state = { ...active, mandate };
  const request = { agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000 };
  assert.equal(decideAgentRequest(state, { ...request, agentId: 'unknown-agent' }).outcome, 'block');
  assert.equal(decideAgentRequest(state, { ...request, amountCents: 60000 }).outcome, 'block');
  assert.equal(decideAgentRequest(state, { ...request, category: 'shopping' }).outcome, 'ask');
  assert.equal(decideAgentRequest(state, { ...request, amountCents: 40000 }).outcome, 'manual_review');
  assert.equal(decideAgentRequest(state, request).outcome, 'execute');
});

test('an in-limit Agent operation that worsens the goal requires manual review', () => {
  const active = activatePlan(createFixture(), 'balanced');
  const state = {
    ...active,
    finance: { ...active.finance, currentMonthExpenseCents: 30000 },
    mandate: {
      id: 'mandate-1', goalId: active.goal.id, category: 'transport', maxPerOperationCents: 50000,
      totalLimitCents: 120000, spentCents: 0, expiresAt: '2026-12-31', active: true,
      version: 1, agentId: 'travel-agent-demo', validFrom: active.clock,
    },
  };
  const decision = decideAgentRequest(state, {
    agentId: 'travel-agent-demo', category: 'transport', amountCents: 30000,
  });
  assert.equal(decision.outcome, 'manual_review');
  assert.equal(decision.reasonCode, 'GOAL_WOULD_WORSEN');
});

test('resolving one impact suppresses only its matching signal', () => {
  const active = activatePlan(createFixture(), 'balanced');
  const applied = applySpendingTrendDemo(active).state;
  const first = applied.riskSignals[0];
  const second = { ...first, id: 'other-signal', impactId: 'other-impact',
    suppressionKey: 'other-fact' };
  const resolved = markActiveRiskSignal({ ...applied, riskSignals: [first, second] }, 'dismiss', first.impactId);
  assert.equal(resolved.riskSignals[0].status, 'dismissed');
  assert.equal(resolved.riskSignals[1].status, 'active');
});

test('replaying a non-immediate spending trend never applies the same transactions twice', () => {
  const state = activatePlan(createFixture(), 'balanced');
  const weeklyOnly = { ...state, riskPreferences: { ...state.riskPreferences,
    amountThresholdCents: 500000 } };
  const first = applySpendingTrendDemo(weeklyOnly);
  assert.equal(first.decision?.outcome, 'weekly_summary');
  const second = applySpendingTrendDemo(first.state);
  assert.equal(second.replayed, true);
  assert.equal(second.state.finance.checkingCents, first.state.finance.checkingCents);
  assert.equal(second.state.finance.currentMonthExpenseCents, first.state.finance.currentMonthExpenseCents);
  assert.equal(second.state.transactions.length, first.state.transactions.length);
});
