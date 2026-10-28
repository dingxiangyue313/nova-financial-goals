import { type SkillId, type SkillOutput } from '../../shared/contracts.ts';
import { getAgentThread, getAgentTaskForThread, getState, type MonitorEvent } from '../store.ts';
import { runMoneyMissionReadTool, type MoneyMissionToolFeedback } from '../agent-read-tools.ts';
import { getEnabledSkill, validateSkillInput, validateSkillOutput } from './registry.ts';
import { financialServicesView } from '../financial-services.ts';

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
  const calls = [...(steps[definition.id]??[])];
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
  if(['mandate_builder','external_agent_request_inbox','recipient_and_split_coordinator','investment_lifecycle_manager','card_lifecycle_manager'].includes(definition.id)){
    if((options.maxTools??8)<1)throw new Error('SKILL_TOOL_BUDGET_EXHAUSTED');
    options.onToolCall?.();
    const view=financialServicesView(getState(sessionId)),refs:string[]=[];
    let facts:SkillOutput['facts']=[];
    const fact=(kind:SkillOutput['facts'][number]['kind'],refId:string,count?:number,amountCents?:number)=>({kind,refId,claimType:'simulated_result' as const,sourceRefs:[refId],...(count===undefined?{}:{count}),...(amountCents===undefined?{}:{amountCents})});
    const select=<T extends {id:string}>(items:T[],id:unknown)=>{if(id!==undefined&&!items.some(x=>x.id===id))throw new Error('SKILL_INVALID_INPUT');return id===undefined?items:items.filter(x=>x.id===id);};
    if(definition.id==='recipient_and_split_coordinator'){
      facts=select(view.recipients,input.recipientId).map(r=>fact('recipient',r.id));
      const splits=select(view.splits,input.operationId);facts.push(...splits.map(s=>fact('split',s.id,s.shares.length,s.shares.reduce((n,x)=>n+x.collectedCents,0))));
    }else if(definition.id==='investment_lifecycle_manager'){
      const products=select(view.products,input.productId);facts=products.map(p=>({...fact('investment',p.id),executable:p.suitable}));
      facts.push(...select(view.investments,input.operationId).map(o=>fact('investment',o.id,undefined,o.amountCents)));
    }else if(definition.id==='card_lifecycle_manager')facts=select(view.cards,input.cardId).map(c=>({...fact('card',c.id,undefined,c.limitCents),executable:c.status==='active'&&c.online&&c.overseas}));
    else if(definition.id==='mandate_builder'){
      if(!['air-demo','stay-demo','travel-agent'].includes(String(input.agentId)))throw new Error('SKILL_INVALID_INPUT');
      if(!view.goals.some(g=>g.id===input.scopeId))throw new Error('SKILL_INVALID_INPUT');
      facts=view.mandates.filter(m=>m.goalId===input.scopeId).map(m=>fact('mandate',m.id,undefined,Math.max(0,m.totalCents-m.spentCents-m.reservedCents)));
    }else {
      const quotes=view.quotes.filter(q=>q.identityVerified&&!q.expired),orders=view.bookings;
      const matching=[...quotes,...orders].filter(q=>q.id===input.requestId);
      if(!matching.length)throw new Error('SKILL_INVALID_INPUT');facts=matching.map(q=>fact('order',q.id,undefined,'totalCents' in q?q.totalCents:q.amountCents));
    }
    preflight();facts.forEach(f=>refs.push(...f.sourceRefs));
    return validateSkillOutput(id,{skillId:definition.id,status:'completed',facts:facts.slice(0,100),evidenceRefs:[...new Set(refs)].slice(0,100),limitations:['PREVIEW_ONLY','SOURCE_LIMITATIONS','NO_EXTERNAL_CONTACT'],nextActionIds:['open-financial-services'],handoff:null});
  }
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
