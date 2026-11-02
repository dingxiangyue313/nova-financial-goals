import type { DemoState } from '../shared/contracts.ts';

export function invalidateGoalRisks(state: DemoState, goalId: string): DemoState {
  let changed = false;
  const riskSignals = state.riskSignals.map(signal => {
    if (signal.goalId !== goalId || (signal.status !== 'active' && signal.status !== 'later')) return signal;
    changed = true;
    return { ...signal, status: 'stale' as const };
  });
  if (!changed) return state;
  return { ...state, riskSignals,
    pendingImpact: state.pendingImpact?.goalId === goalId ? null : state.pendingImpact };
}
