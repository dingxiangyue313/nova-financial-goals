import { Goal, ImpactScenario } from '../types';

export const NOVA_LOGO_URL =
  'https://lh3.googleusercontent.com/aida-public/AB6AXuBxym-8QTVoTGSvph_s_bxAIReQdQcuKb8ndtnZGMHx6MoPBkeGQoKUiFZGKYzhuE2Uvhf1BVUiwTmjX2teFG_FpFUaerGVV9EtVH4rB5CFBCqx_6BC-BooyzqQxiZUJIJ6aVwGKIkXpBg0vkSMk3q-JDEqkr50I36Z8r2TsygDTY14yqY2QoOjyVLvu7JVhPT_W5xlWt2eMdSHCRWMb3MBcvt-0JZc89ZYn3yHKSy84tIGd0frGysfvKJagoOLMecA7n8';

export const JAPAN_TRIP_IMG =
  'https://lh3.googleusercontent.com/aida/AEtjO1UrwbCWWFERF-Q6qaqJaXETXbphhrx4S6cHkreRUfDf1RmQQM91tfbxSEg6NgOztnIflKRoZqpXV6lf6TP2CDg74qhxuSZ4MnLj4PlVqIo2UirrbkvgYAlEDtm6gLrG710cn4v8VCjgrw0eOEufJdfbyWC66IgTDEtMo6fDswf29rG2NN2CGC0GXpzCDihK6lpa59ywP8FIHxxR19FOlokWcPMrCV82urfygNsMjEgntfouq79dAvkn5ema';

export const initialGoal: Goal = {
  id: 'goal-japan-2026',
  title: '日本旅行',
  targetAmount: 8000,
  currentAmount: 3500,
  targetDate: '2026年12月15日',
  originalDate: '2026年12月15日',
  monthlySavings: 1500,
  emergencyFundProtected: 20000,
  status: 'normal',
  imageUrl: JAPAN_TRIP_IMG,
  flexibilityWeeks: 2,
  quote: '“我想三个月后去日本旅行，预算¥8,000，不能动应急金。”',
  delayDays: 0,
};

export const defaultImpactScenario: ImpactScenario = {
  expenseTitle: '汽车保养支出',
  expenseAmount: 900,
  expenseDate: '9月20日',
  impactDays: 18,
  previousMonthly: 1500,
  adjustedMonthlyRemaining: 600,
  emergencyFundAmount: 20000,
  optionA: {
    title: '方案 A：每月多存 ¥300，保持原日期',
    description: '未来 3 个月微调每月存入 ¥1,800，确保按时在 12月15日 出发。',
    increasePerMonth: 300,
    newMonthly: 1800,
    completionDate: '2026年12月15日',
  },
  optionB: {
    title: '方案 B：将旅行延后 18 天，每月金额不变',
    description: '维持每月存入 ¥1,500，平移出行窗口至 2027年1月2日。',
    delayDays: 18,
    newMonthly: 1500,
    completionDate: '2027年1月2日',
  },
};
