import { type SkillId, type SkillOutput } from '../../shared/contracts.ts';
import { getAgentThread, getAgentTaskForThread, getState, type MonitorEvent } from '../store.ts';
import { runMoneyMissionReadTool, type MoneyMissionToolFeedback } from '../agent-read-tools.ts';
import { getEnabledSkill, validateSkillInput, validateSkillOutput } from './registry.ts';

const steps: Partial<Record<SkillId, string[]>> = {
  statement_ingestion_and_reconciliation: ['inspect_statement_file', 'list_import_issues'],
  bill_and_subscription_investigator: ['summarize_bill_period', 'detect_subscription_candidates'],
  dated_cashflow_forecast: ['build_cashflow_timeline'],
  goal_portfolio_planner: ['read_goal_constraints', 'search_goal_options'],
  transfer_and_savings_executor: ['list_transfer_eligible_accounts'],
  outcome_monitor_and_replanner: ['screen_material_goal_events'],
  financial_explanation_and_provenance: ['read_explanation_evidence'],
  human_handoff_case_pack: ['read_relevant_evidence'],
};
const handoffs: Partial<Record<SkillId, SkillId>> = {
  statement_ingestion_and_reconciliation: 'bill_and_subscription_investigator',
  bill_and_subscription_investigator: 'dated_cashflow_forecast', dated_cashflow_forecast: 'goal_portfolio_planner',
  goal_portfolio_planner: 'transfer_and_savings_executor', transfer_and_savings_executor: 'outcome_monitor_and_replanner',
  outcome_monitor_and_replanner: 'goal_portfolio_planner',
};
export type SkillExecutionOptions = { signal?: AbortSignal; maxTools?: number; deadlineAt?: number;
  onToolCall?: () => void; assertCurrent?: () => void; monitorEvent?: MonitorEvent };

/** Runs a fixed adapter sequence: no model-supplied tools, arguments or write calls. */
export async function executeMoneyMissionSkill(sessionId: string, threadId: string, id: string,
  rawInput: unknown, options: SkillExecutionOptions = {}): Promise<SkillOutput> {
  const definition = getEnabledSkill(id);
  const input = validateSkillInput(id, rawInput);
  try { getAgentThread(sessionId, threadId); } catch { throw new Error('SKILL_THREAD_NOT_FOUND'); }
  const version = getState(sessionId).twinVersion;
  const revision = getAgentTaskForThread(sessionId, threadId)?.taskRevision;
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + definition.timeoutMs);
  const preflight = () => {
    if (options.signal?.aborted) throw new Error('SKILL_CANCELLED');
    if (Date.now() >= deadlineAt) throw new Error('SKILL_TIMEOUT');
    let thread;
    try { thread = getAgentThread(sessionId, threadId); } catch { throw new Error('SKILL_THREAD_NOT_FOUND'); }
    if (thread.status !== 'active' || thread.readOnly) throw new Error('SKILL_CANCELLED');
    if (getState(sessionId).twinVersion !== version ||
      getAgentTaskForThread(sessionId, threadId)?.taskRevision !== revision) throw new Error('SKILL_RUN_STALE');
    options.assertCurrent?.();
  };
  const calls = [...steps[definition.id]!];
  if (definition.id === 'bill_and_subscription_investigator' && input.subscriptionId) calls.push('inspect_subscription_history');
  if (definition.id === 'transfer_and_savings_executor') calls.push(input.scheduleId
    ? 'get_transfer_schedule_status' : 'simulate_transfer_schedule');
  const budget = Math.min(definition.maxToolCalls, options.maxTools ?? definition.maxToolCalls);
  const results: MoneyMissionToolFeedback[] = [];
  for (const tool of calls) {
    preflight();
    if (results.length >= budget) throw new Error('SKILL_TOOL_BUDGET_EXHAUSTED');
    options.onToolCall?.();
    results.push(runMoneyMissionReadTool(sessionId, definition.id, tool, input, { threadId, monitorEvent: options.monitorEvent }));
  }
  preflight();
  const limitations = [...new Set(results.flatMap(result => result.limitations))];
  // Confirmation is a workspace boundary, not a transition to monitoring.
  const handoff = limitations.includes('CONFIRMATION_REQUIRED') ? null : handoffs[definition.id] ?? null;
  return validateSkillOutput(id, { skillId: definition.id,
    status: limitations.includes('CONFIRMATION_REQUIRED') ? 'awaiting_confirmation'
      : limitations.includes('DATA_REQUIRED') ? 'awaiting_user' : 'completed',
    facts: results.flatMap(result => result.facts).slice(0, 100),
    evidenceRefs: [...new Set(results.flatMap(result => result.evidenceRefs))].slice(0, 100),
    limitations, nextActionIds: [...new Set(results.flatMap(result => result.nextActionIds))],
    handoff: handoff ? getEnabledSkill(handoff).id : null });
}
