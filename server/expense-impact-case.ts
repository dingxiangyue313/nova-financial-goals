import { activatePlan, injectExpense } from './domain.ts';
import { createFixture } from './fixtures.ts';
import { evaluateOneOffExpenseRisk, RISK_RULE_VERSION } from './risk.ts';
import { previewRiskRepair } from './risk-repair.ts';
import { snapshot } from './presentation.ts';
import { ExpenseImpactCaseSchema, type DemoState } from '../shared/contracts.ts';

// A read-only example, independent of the user's current simulated account.
export function expenseImpactCase() {
  const before = activatePlan(createFixture(), 'balanced');
  const expense = injectExpense(before, 90000, '汽车保养');
  const decision = evaluateOneOffExpenseRisk(before, 90000);
  if (!expense.impact || decision.outcome !== 'immediate_signal' || !decision.goalImpact)
    throw new Error('INVALID_EXPENSE_CASE');
  const state: DemoState = { ...expense.state, twinVersion: before.twinVersion + 1,
    transactions: [{ id: 'expense-case-transaction', accountId: 'checking', date: before.clock,
      title: '汽车保养', category: 'expense', amountCents: -90000 }, ...before.transactions],
    riskSignals: [{ id: 'expense-case-signal', goalId: before.goal.id, patternId: 'expense-case',
      impactId: expense.impact.id, createdAt: before.clock, title: '汽车保养影响日本旅行',
      decision: 'immediate_signal', evidence: [{transactionId: 'expense-case-transaction', date: before.clock, amountCents: 90000}],
      confidence: 'high', ruleVersion: RISK_RULE_VERSION, twinVersion: before.twinVersion + 1,
      impact: decision.goalImpact, status: 'active', suppressionKey: 'expense-case' }] };
  const request = { impactId: expense.impact.id, expectedTwinVersion: state.twinVersion };
  return ExpenseImpactCaseSchema.parse({ snapshot: snapshot(state), previews: {
    keep_target_date: previewRiskRepair(state, { ...request, strategy: 'keep_target_date' }),
    keep_monthly_contribution: previewRiskRepair(state, { ...request, strategy: 'keep_monthly_contribution' }),
  } });
}
