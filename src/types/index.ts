export type ScreenId = 'ai_safety' | 'financial_services' | 'home' | 'workspace' | 'money_mission' | 'create_goal' | 'data_connections' | 'feasibility' | 'plan_change' | 'impact' | 'goals_list' | 'activity' | 'profile' | 'banking_demo';
export type { MoneyMissionReadModel } from '../../shared/contracts';

export interface Goal {
  id: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  progressPercent: number;
  targetDate: string; // e.g. '2026-12-15'
  originalDate?: string;
  monthlySavings: number;
  emergencyFundProtected: number;
  status: 'normal' | 'delayed' | 'ahead';
  imageUrl: string;
  flexibilityWeeks: number;
  quote?: string;
  delayDays?: number;
}

export interface ImpactScenario {
  expenseTitle: string;
  expenseAmount: number;
  expenseDate: string;
  impactDays: number;
  previousMonthly: number;
  adjustedMonthlyRemaining: number;
  emergencyFundAmount: number;
  optionA: {
    title: string;
    description: string;
    increasePerMonth: number;
    newMonthly: number;
    completionDate: string;
    available: boolean;
  };
  optionB: {
    title: string;
    description: string;
    delayDays: number;
    newMonthly: number;
    completionDate: string;
  };
}
