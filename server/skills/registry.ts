import { z } from 'zod';
import { SkillIdSchema, EnabledSkillIdSchema, SkillDefinitionSchema, SkillReferenceIdSchema as Ref, SkillOutputSchema,
  type SkillId, type SkillDefinition, type SkillOutput } from '../../shared/contracts.ts';

const Inputs = {
  statement_ingestion_and_reconciliation: z.object({ batchId: Ref }).strict(),
  bill_and_subscription_investigator: z.object({ periodId: Ref, subscriptionId: Ref.optional() }).strict(),
  dated_cashflow_forecast: z.object({ accountId: Ref, goalId: Ref }).strict(),
  goal_portfolio_planner: z.object({ goalId: Ref }).strict(),
  transfer_and_savings_executor: z.object({ scheduleId: Ref.optional(), previewId: Ref.optional() }).strict()
    .refine(value => Boolean(value.scheduleId) !== Boolean(value.previewId)),
  mandate_builder: z.object({ agentId: Ref, scopeId: Ref }).strict(),
  external_agent_request_inbox: z.object({ requestId: Ref }).strict(),
  outcome_monitor_and_replanner: z.object({ goalId: Ref, scheduleId: Ref.optional() }).strict(),
  financial_explanation_and_provenance: z.object({ evidenceId: Ref }).strict(),
  human_handoff_case_pack: z.object({ goalId: Ref.optional(), evidenceIds: z.array(Ref).max(30).default([]) }).strict(),
} satisfies Record<SkillId, z.ZodType>;

const tools: Record<SkillId, readonly string[]> = {
  statement_ingestion_and_reconciliation: ['inspect_statement_file', 'preview_statement_mapping',
    'detect_duplicate_transactions', 'detect_refunds_and_internal_transfers', 'preview_import_batch',
    'list_import_issues', 'prepare_import_batch'],
  bill_and_subscription_investigator: ['summarize_bill_period', 'compare_spending_baseline',
    'list_relevant_transactions', 'detect_subscription_candidates', 'inspect_subscription_history',
    'assess_transaction_goal_impact', 'prepare_subscription_action'],
  dated_cashflow_forecast: ['list_cashflow_events', 'build_cashflow_timeline',
    'simulate_cashflow_scenario', 'compare_cashflow_scenarios', 'inspect_forecast_evidence'],
  goal_portfolio_planner: ['read_goal_constraints', 'read_goal_allocations', 'search_goal_options',
    'stress_test_goal_options', 'repair_stressed_goal_option', 'detect_goal_funding_conflicts', 'prepare_goal_candidate'],
  transfer_and_savings_executor: ['list_transfer_eligible_accounts', 'simulate_transfer_schedule',
    'prepare_internal_transfer', 'prepare_recurring_transfer', 'get_transfer_schedule_status',
    'prepare_pause_transfer_schedule', 'prepare_cancel_transfer_schedule'],
  mandate_builder: ['resolve_verified_agent_identity', 'validate_mandate_scope', 'simulate_mandate_examples',
    'prepare_create_mandate', 'prepare_update_mandate', 'prepare_pause_mandate', 'prepare_revoke_mandate'],
  external_agent_request_inbox: ['read_external_request', 'read_agent_identity_result', 'match_request_to_mandate',
    'assess_external_request_risk', 'assess_request_goal_impact', 'prepare_external_request_decision', 'get_external_operation_status'],
  outcome_monitor_and_replanner: ['screen_material_goal_events', 'read_event_evidence', 'assess_event_goal_impact',
    'search_repair_options', 'stress_test_repair_options', 'prepare_monitor_notification', 'schedule_followup'],
  financial_explanation_and_provenance: ['read_explanation_evidence', 'render_calculation_breakdown',
    'resolve_user_facing_labels', 'validate_explanation_grounding'],
  human_handoff_case_pack: ['read_task_history_summary', 'read_relevant_evidence', 'list_attempted_actions',
    'prepare_case_pack', 'export_case_pack'],
};
const descriptions: Record<SkillId, string> = {
  statement_ingestion_and_reconciliation: 'Inspect reconciled statement previews and issues; confirmation commits imports.',
  bill_and_subscription_investigator: 'Investigate bill evidence and subscription history without cancelling services.',
  dated_cashflow_forecast: 'Build dated cashflow using authoritative snapshots and deterministic services.',
  goal_portfolio_planner: 'Compare evidence-based goal options without activating a plan.',
  transfer_and_savings_executor: 'Inspect and prepare savings schedules for workspace confirmation.',
  mandate_builder: 'Prepare bounded mandates; disabled P1 stretch capability.',
  external_agent_request_inbox: 'Review external requests against verified authority; disabled P1 stretch capability.',
  outcome_monitor_and_replanner: 'Inspect monitored execution outcomes and route repairs for review.',
  financial_explanation_and_provenance: 'Resolve calculations and evidence with explicit provenance.',
  human_handoff_case_pack: 'Assemble minimal evidence for user-directed human handoff without external contact.',
};
const kinds: Record<SkillId, readonly string[]> = {
  statement_ingestion_and_reconciliation: ['import_batch', 'import_issue'],
  bill_and_subscription_investigator: ['bill', 'subscription', 'evidence'],
  dated_cashflow_forecast: ['forecast'], goal_portfolio_planner: ['goal', 'plan'],
  transfer_and_savings_executor: ['account', 'schedule'], mandate_builder: [], external_agent_request_inbox: [],
  outcome_monitor_and_replanner: ['goal', 'schedule', 'execution', 'plan'],
  financial_explanation_and_provenance: ['evidence'], human_handoff_case_pack: ['case_pack', 'evidence', 'execution'],
};
export type RegisteredSkillDefinition = SkillDefinition & { id: SkillId };
export const CORE_SKILL_IDS = Object.freeze([...EnabledSkillIdSchema.options]);
const definitions = SkillIdSchema.options.map(id => {
  const enabled = !['mandate_builder', 'external_agent_request_inbox'].includes(id);
  const canPrepareAction = !['dated_cashflow_forecast', 'financial_explanation_and_provenance',
    'human_handoff_case_pack'].includes(id);
  return { ...SkillDefinitionSchema.parse({ name: id, version: '0.6.0', description: descriptions[id],
    riskClass: canPrepareAction ? 'prepare_write' : 'read', inputSchema: Inputs[id],
    outputSchema: SkillOutputSchema.extend({ skillId: z.literal(id) }).refine(value =>
      value.facts.every(fact => kinds[id].includes(fact.kind))),
    allowedTools: [...tools[id]], maxToolCalls: 8, timeoutMs: 45_000,
    requiresEvidence: true, canPrepareAction, canExecuteAction: false, enabled,
    release: enabled ? 'p0' : 'p1_stretch' }), id };
});

// Never expose the mutable authority table to model callers or UI consumers.
export function listSkillDefinitions(): RegisteredSkillDefinition[] {
  return definitions.map(value => ({ ...value, allowedTools: [...value.allowedTools] }));
}
export function getEnabledSkill(id: string): RegisteredSkillDefinition {
  const definition = definitions.find(value => value.id === id);
  if (!definition) throw new Error('SKILL_NOT_FOUND');
  if (!definition.enabled) throw new Error('SKILL_NOT_ENABLED');
  return { ...definition, allowedTools: [...definition.allowedTools] };
}
export function assertSkillToolAllowed(id: string, tool: string): void {
  const skill = getEnabledSkill(id);
  if (!tools[skill.id].includes(tool)) throw new Error('SKILL_TOOL_FORBIDDEN');
}
export function validateSkillInput(id: string, input: unknown): Record<string, unknown> {
  const parsed = (getEnabledSkill(id).inputSchema as z.ZodType).safeParse(input);
  if (!parsed.success) throw new Error('SKILL_INVALID_INPUT');
  return parsed.data as Record<string, unknown>;
}
export function validateSkillOutput(id: string, output: unknown): SkillOutput {
  const parsed = (getEnabledSkill(id).outputSchema as z.ZodType<SkillOutput>).safeParse(output);
  if (!parsed.success) throw new Error('SKILL_INVALID_OUTPUT');
  return parsed.data;
}
export function routeMoneyMissionSkill(intent: string, phase: string): SkillId {
  if (intent === 'handoff') return 'human_handoff_case_pack';
  if (!['import', 'bill', 'subscription', 'forecast', 'goal', 'transfer', 'monitor', 'explain'].includes(intent))
    return 'human_handoff_case_pack';
  if (phase === 'monitoring' || intent === 'monitor') return 'outcome_monitor_and_replanner';
  if (phase === 'explanation' || intent === 'explain') return 'financial_explanation_and_provenance';
  if (intent === 'import') return 'statement_ingestion_and_reconciliation';
  if (intent === 'bill' || intent === 'subscription') return 'bill_and_subscription_investigator';
  if (phase === 'forecast' || intent === 'forecast') return 'dated_cashflow_forecast';
  if (intent === 'transfer') return 'transfer_and_savings_executor';
  return 'goal_portfolio_planner';
}
