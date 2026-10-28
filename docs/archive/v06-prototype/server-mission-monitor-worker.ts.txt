import { getState, listMoneyMissionMonitorSessions, mutateState } from './store.ts';
import { screenMissionOutcomes } from './mission-monitor.ts';

export function tickMoneyMissionMonitor(limit = 100) {
  let updated = 0;
  for (const sessionId of listMoneyMissionMonitorSessions(limit)) {
    const state = getState(sessionId);
    const next = screenMissionOutcomes(state);
    if (JSON.stringify(next.mission?.notifications) === JSON.stringify(state.mission?.notifications)) continue;
    mutateState(sessionId, current => screenMissionOutcomes(current));
    updated++;
  }
  return updated;
}
