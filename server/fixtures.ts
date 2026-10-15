import type { DemoState } from '../shared/contracts.ts';

export const JAPAN_IMAGE = 'https://lh3.googleusercontent.com/aida/AEtjO1UrwbCWWFERF-Q6qaqJaXETXbphhrx4S6cHkreRUfDf1RmQQM91tfbxSEg6NgOztnIflKRoZqpXV6lf6TP2CDg74qhxuSZ4MnLj4PlVqIo2UirrbkvgYAlEDtm6gLrG710cn4v8VCjgrw0eOEufJdfbyWC66IgTDEtMo6fDswf29rG2NN2CGC0GXpzCDihK6lpa59ywP8FIHxxR19FOlokWcPMrCV82urfygNsMjEgntfouq79dAvkn5ema';

export function createFixture(): DemoState {
  return {
    clock: '2026-09-21',
    goal: {
      id: 'goal-japan-2026', title: '日本旅行', targetCents: 800000,
      savedCents: 350000, targetDate: '2026-12-15', originalDate: '2026-12-15',
      monthlyContributionCents: 150000, protectedCents: 2000000,
      flexibilityWeeks: 2, status: 'draft', selectedPlanId: null,
      imageUrl: JAPAN_IMAGE,
      quote: '我想三个月后去日本旅行，预算¥8,000，不能动应急金。',
    },
    finance: {
      checkingCents: 500000, emergencyCents: 2000000,
      monthlyIncomeCents: 900000, fixedBillsCents: 450000,
      essentialSpendingCents: 250000, currentMonthExpenseCents: 0,
      historyMonths: 3, updatedAt: '2026-09-21',
    },
    twinVersion: 1,
    accounts: [
      { id: 'checking', label: '日常活期', type: 'checking', balanceCents: 500000, currency: 'CNY', protected: false },
      { id: 'emergency', label: '应急金', type: 'emergency', balanceCents: 2000000, currency: 'CNY', protected: true },
      { id: 'goal-wallet', label: '旅行目标钱包', type: 'goal', balanceCents: 350000, currency: 'CNY', protected: false },
      { id: 'jpy-wallet', label: '日元旅行钱包', type: 'goal', balanceCents: 0, currency: 'JPY', protected: false },
    ],
    transactions: [
      { id: 'tx-salary', accountId: 'checking', date: '2026-09-01', title: '工资', category: 'income', amountCents: 900000 },
      { id: 'tx-rent', accountId: 'checking', date: '2026-09-05', title: '房租与固定账单', category: 'bills', amountCents: -450000 },
    ],
    bills: [{ id: 'bill-mobile', title: '通信账单', dueDate: '2026-09-25', amountCents: 12000, paid: false }],
    subscriptions: [{ id: 'sub-stream', title: 'StreamPlus', monthlyCents: 5500, nextChargeDate: '2026-09-23', status: 'active' }],
    approvals: [], receipts: [], consumedNonces: [], toolRecords: [],
    riskPreferences: {
      amountThresholdCents: 50000,
      goalImpactRatioThresholdBps: 500,
      weeklySummaryEnabled: true,
      quietHours: null,
      pausedUntil: null,
      goalOverrides: {},
    },
    spendingPatterns: [], riskSignals: [], weeklyRiskSummaries: [],
    pendingImpact: null, mandate: null, audit: [], operations: [],
  };
}
