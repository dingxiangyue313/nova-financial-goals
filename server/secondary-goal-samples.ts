import type { DemoState, Goal } from '../shared/contracts.ts';
import { appendAuditEvent } from './governance.ts';

export function addSecondaryGoalSamples(state: DemoState): DemoState {
  if (state.audit.some(event => event.action === 'secondary_goal_samples_v2')) return state;
  const year = Number(state.clock.slice(0, 4)) + 1;
  const samples = [
    ['learning', '学习进修', 600000, 30000, `${year}-12-31`, 240000, 'active'],
    ['computer', '电脑换新', 800000, 20000, `${year + 1}-06-30`, 320000, 'active'],
    ['health', '家人体检', 300000, 15000, `${year}-06-30`, 210000, 'active'],
    ['moving', '搬家准备', 500000, 25000, `${year + 1}-03-31`, 150000, 'paused'],
    ['hobby', '兴趣基金', 200000, 10000, `${year}-03-31`, 200000, 'achieved'],
  ] as const;
  const goals: Goal[] = samples
    .map(([id, title, targetCents, monthlyContributionCents, targetDate, savedCents, status]) => ({
      id: `sample-goal-${id}`, title, targetCents, monthlyContributionCents, targetDate,
      originalDate: targetDate, savedCents, protectedCents: state.finance.emergencyCents,
      flexibilityWeeks: 4, status, selectedPlanId: status === 'active' ? 'balanced' : null, imageUrl: '',
      quote: `为${title}提前准备，按自己的节奏积累。`,
    }));
  const nextGoals = [...state.goals];
  for (const goal of goals) {
    const index = nextGoals.findIndex(item => item.id === goal.id);
    if (index < 0) nextGoals.push(goal);
    else if (nextGoals[index].savedCents === 0 && nextGoals[index].status === 'draft') nextGoals[index] = goal;
  }
  const next = { ...state, goals: nextGoals, twinVersion: state.twinVersion + 1 };
  return appendAuditEvent(next, 'secondary_goal_samples_v2', 'succeeded', '更新模拟目标历史进度与状态，未执行转账或自动储蓄。');
}
