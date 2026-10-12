import type { FinancialTwinState } from "./financial-twin-contracts";
import { forecastTwin, goalPlanContributions, type CashflowForecast } from "./financial-twin-engine";

export type GoalReadinessStatus = "insufficient_data" | "on_track" | "at_risk" | "infeasible";
export type GoalPlan = "conservative" | "balanced" | "accelerated";

const DAY = 86_400_000;
const iso = (value: Date) => value.toISOString().slice(0, 10);

export function getGoalReadiness(
  state: FinancialTwinState,
  goalId: string,
  forecast: CashflowForecast = forecastTwin(state),
  at = new Date(),
) {
  const goal = state.goals.find(item => item.id === goalId);
  if (!goal) throw new Error("GOAL_NOT_FOUND");
  const remaining = Math.max(0, goal.targetAmount - goal.savedAmount);
  const daysUntilTarget = Math.max(1, Math.ceil((Date.parse(`${goal.targetDate}T00:00:00Z`) - at.getTime()) / DAY));
  const monthlyRequired = Math.ceil(remaining / Math.max(1, daysUntilTarget / 30));
  const contributions = goalPlanContributions(goal, at);
  const hasAccount = state.accounts.some(account => account.type === "checking");
  const hasIncome = state.cashflows.some(event => event.amount > 0);
  const dataSufficient = hasAccount && hasIncome && state.cashflows.length >= 2;
  const available = forecast.safeToSpend;
  const options = (Object.keys(contributions) as GoalPlan[]).map(id => {
    const contribution = contributions[id];
    const months = remaining === 0 ? 0 : Math.ceil(remaining / Math.max(1, contribution));
    const projectedDate = iso(new Date(at.getTime() + months * 30 * DAY));
    return {
      id,
      monthlyContribution: contribution,
      projectedDate,
      safeToSpendAfter: Math.max(0, available - contribution),
      withinSafeBalance: contribution <= available,
      onTime: projectedDate <= goal.targetDate,
    };
  });
  const status: GoalReadinessStatus = !dataSufficient
    ? "insufficient_data"
    : options.every(option => !option.withinSafeBalance)
      ? "infeasible"
      : monthlyRequired > available || forecast.goalCompetition.some(item => item.goalId === goalId && item.shortfall > 0)
        ? "at_risk"
        : "on_track";
  return {
    goalId,
    status,
    dataSufficient,
    missing: [...(!hasAccount ? ["活期账户"] : []), ...(!hasIncome ? ["收入记录"] : []), ...(state.cashflows.length < 2 ? ["足够的现金流记录"] : [])],
    remaining,
    monthlyRequired,
    availableMonthly: available,
    options,
    selectedPlan: goal.selectedPlan,
    updatedAt: state.updatedAt,
  };
}

export type GoalReadiness = ReturnType<typeof getGoalReadiness>;
