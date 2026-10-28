import { DemoStateSchema, type DemoState } from '../shared/contracts.ts';
import { createFixture } from './fixtures.ts';

/** Frozen synthetic scenario. Historical evidence never derives these balances. */
export function createJapanMoneyMissionFixture(): DemoState {
  const legacy = createFixture();
  const goal: DemoState['goal'] = {
    ...legacy.goal, id: 'goal-japan-2027', savedCents: 200000,
    targetDate: '2027-06-30', originalDate: '2027-06-30', monthlyContributionCents: 100000,
    quote: '我想在2027年6月30日前存够¥8,000去日本旅行，不能动应急金。',
  };
  const accounts: DemoState['accounts'] = [
    { id: 'checking', label: '工资卡', type: 'checking', balanceCents: 724000, currency: 'CNY', protected: false },
    { id: 'emergency', label: '应急金', type: 'emergency', balanceCents: 2000000, currency: 'CNY', protected: true },
    { id: 'goal-wallet', label: '旅行目标钱包', type: 'goal', balanceCents: 200000, currency: 'CNY', protected: false },
  ];
  return DemoStateSchema.parse({
    ...legacy, clock: '2026-10-26', goal, goals: [goal], primaryGoalId: goal.id, accounts,
    finance: {
      checkingCents: 724000, emergencyCents: 2000000, monthlyIncomeCents: 850000,
      fixedBillsCents: 370000, essentialSpendingCents: 30000, currentMonthExpenseCents: 0,
      historyMonths: 3, updatedAt: '2026-10-26',
    },
    accountSnapshots: accounts.map(account => ({
      id: `snapshot-${account.id}-2026-10-26`, accountId: account.id, balanceCents: account.balanceCents,
      currency: account.currency, asOf: '2026-10-26', sourceKind: 'simulated_connection',
      sourceId: 'money-mission-synthetic-bank', twinVersion: 1, createdAt: '2026-10-26T12:00:00+08:00',
    })),
    transactions: [{ id: 'salary-2026-10', accountId: 'checking', date: '2026-10-25', title: '工资',
      category: 'income', amountCents: 850000, sourceKind: 'bank', provenance: 'connected_data' }],
    bills: [
      { id: 'rent', title: '房租', dueDate: '2026-11-01', amountCents: 280000, paid: false },
      { id: 'daily-purchase', title: '计划内日常采购', dueDate: '2026-11-08', amountCents: 30000, paid: false },
      { id: 'utilities', title: '水电', dueDate: '2026-11-10', amountCents: 42000, paid: false },
      { id: 'transport', title: '交通', dueDate: '2026-11-15', amountCents: 20000, paid: false },
      { id: 'insurance', title: '保险', dueDate: '2026-11-18', amountCents: 28000, paid: false },
    ],
    subscriptions: [{ id: 'cloudbox-plus', title: 'CloudBox Plus', monthlyCents: 6800,
      nextChargeDate: '2026-11-05', status: 'active' }],
  });
}
