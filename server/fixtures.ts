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
    pendingImpact: null, mandate: null, audit: [], operations: [],
  };
}
