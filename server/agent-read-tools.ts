import {runBankingTool} from './banking.ts';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentReadToolNameSchema, AgentToolResultSchema, CandidateInputSchema, SearchGoalOptionsInputSchema,
  StressTestGoalOptionsInputSchema, RepairStressedGoalOptionInputSchema,
  type AgentToolResult, type AgentToolSource, type CandidateInput, type DemoState } from '../shared/contracts.ts';
import { assessCandidateScenario, availableMonthly } from './domain.ts';
import { searchGoalOptions } from './goal-option-search.ts';
import { searchStressRepair } from './stress-repair-search.ts';
import { previewGoalScenario } from './scenario.ts';
import { getAgentTaskForThread, getAgentToolResult, getState, saveAgentToolResult,
  updateAgentTask } from './store.ts';

const Empty = z.object({}).strict();
const TransactionsInput = z.object({ category: z.string().min(1).max(60).optional(),
  limit: z.number().int().min(1).max(30).default(20) }).strict();
const supported = new Set(['baseline', 'current_month_expense', 'monthly_income_reduction',
  'monthly_essential_spending_increase', 'missed_contribution_once']);
type Source = AgentToolSource;

function validatedInput(name: string, input: unknown) {
  if (!AgentReadToolNameSchema.safeParse(name).success) throw new Error('READ_TOOL_NOT_ALLOWED');
  const schema = name === 'evidence_detail' ? z.object({evidenceId:z.string()}).strict() : name==='dated_cashflow_forecast' ? z.object({horizonDays:z.number().int().min(1).max(366).default(62),scenario:z.enum(['baseline','stress']).default('baseline')}).strict() : name === 'candidate_preview' ? CandidateInputSchema
    : name === 'relevant_transactions' ? TransactionsInput
      : name === 'search_goal_options' ? SearchGoalOptionsInputSchema
        : name === 'stress_test_goal_options' ? StressTestGoalOptionsInputSchema
          : name === 'repair_stressed_goal_option' ? RepairStressedGoalOptionInputSchema : Empty;
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error('READ_TOOL_INVALID_INPUT');
  return parsed.data;
}

function referencedResults(sessionId: string, threadId: string, taskId: string, runId: string,
  version: number, ids: string[], state: DemoState): AgentToolResult[] {
  return ids.map(id => {
    const result = getAgentToolResult(sessionId, threadId, id);
    if (result.taskId !== taskId || result.demoRunId !== runId || result.twinVersion !== version)
      throw new Error('READ_TOOL_EVIDENCE_NOT_ALLOWED');
    for (const source of result.sourceEntities) {
      if (source.kind === 'account' && !state.accounts.some(item => item.id === source.id))
        throw new Error('READ_TOOL_EVIDENCE_STALE');
      if (source.kind === 'bill' && !state.bills.some(item => item.id === source.id))
        throw new Error('READ_TOOL_EVIDENCE_STALE');
      if (source.kind === 'transaction' && !state.transactions.some(item => item.id === source.id))
        throw new Error('READ_TOOL_EVIDENCE_STALE');
    }
    return result;
  });
}

function candidateResult(sessionId: string, threadId: string, input: CandidateInput,
  state: DemoState, task: NonNullable<ReturnType<typeof getAgentTaskForThread>>) {
  if (!task.facts.title || task.facts.targetCents === null || !task.facts.originalTargetDate)
    throw new Error('READ_TOOL_GOAL_INCOMPLETE');
  const evidence = referencedResults(sessionId, threadId, task.taskId, task.demoRunId,
    state.twinVersion, input.evidenceResultIds, state);
  const sources: Source[] = [{ kind: 'task', id: task.taskId }, { kind: 'finance', id: 'finance' },
    ...state.accounts.filter(item => item.type === 'checking' || item.type === 'emergency')
      .map(item => ({ kind: 'account' as const, id: item.id })),
    ...evidence.map(item => ({ kind: 'tool_result' as const, id: item.toolResultId }))];
  const assumptions = ['模拟月收入、固定账单和必要支出按当前财务概况估计',
    '应急金与额外保护金额不用于目标投入', '预计日期是估算，不是完成保证'];
  const gaps: string[] = [];
  if (!supported.has(input.scenario.kind)) return {
    status: 'unsupported' as const, errorCode: 'READ_TOOL_SCENARIO_UNSUPPORTED',
    output: { input, assessment: null, previewId: null }, sources, assumptions,
    gaps: [`${input.scenario.kind} 暂无可验证的逐日或概率模型`],
  };
  const scenario = input.scenario;
  const count = Math.max(1, Math.ceil((Date.parse(`${input.targetDate}T00:00:00Z`) -
    Date.parse(`${state.clock}T00:00:00Z`)) / 86_400_000 / 30));
  const ongoing = scenario.kind === 'monthly_income_reduction' ||
    scenario.kind === 'monthly_essential_spending_increase';
  const missed = scenario.kind === 'missed_contribution_once';
  const needsAmount = scenario.kind === 'current_month_expense' || ongoing;
  if ((needsAmount ? !scenario.amountCents || scenario.amountCents <= 0 : scenario.amountCents !== undefined) ||
    (ongoing ? scenario.startMonthIndex !== undefined && scenario.startMonthIndex >= count
      : scenario.startMonthIndex !== undefined) ||
    (missed ? scenario.monthIndex === undefined || scenario.monthIndex >= count
      : scenario.monthIndex !== undefined)) throw new Error('READ_TOOL_INVALID_SCENARIO');
  const violations: string[] = [];
  if (input.targetCents < task.facts.targetCents) violations.push('TARGET_BUDGET_BELOW_USER_REQUIREMENT');
  if (input.targetDate < task.facts.originalTargetDate || input.targetDate < state.clock)
    violations.push('TARGET_DATE_BEFORE_ALLOWED_START');
  if (input.targetDate > (task.constraints.latestAllowedDate ?? task.facts.originalTargetDate))
    violations.push('TARGET_DATE_AFTER_ALLOWED_END');
  if (task.constraints.monthlyContributionCapCents !== null &&
    input.monthlyContributionCents > task.constraints.monthlyContributionCapCents)
    violations.push('USER_MONTHLY_CAP_EXCEEDED');
  if (input.firstMonthContributionCents !== undefined &&
    (input.firstMonthContributionCents > input.monthlyContributionCents ||
      input.firstMonthContributionCents > (task.constraints.monthlyContributionCapCents ?? Number.MAX_SAFE_INTEGER)))
    violations.push('FIRST_MONTH_CONTRIBUTION_INVALID');
  if (input.protectedCents < Math.max(task.constraints.protectedCents ?? 0, state.finance.emergencyCents))
    violations.push('PROTECTED_FUNDS_REDUCED');
  const assumptionsInput = { targetCents: input.targetCents, targetDate: input.targetDate,
    monthlyContributionCents: input.monthlyContributionCents,
    protectedCents: input.protectedCents, flexibilityWeeks: 0 };
  const preview = scenario.kind === 'baseline' ? previewGoalScenario(state, assumptionsInput,
    { id: task.goalDraftId ?? task.taskId, title: task.facts.title, savedCents: task.facts.savedCents ?? 0 }) : null;
  const calculated = assessCandidateScenario(state, input, task.facts.savedCents ?? 0, violations,
    task.constraints.latestAllowedDate ?? task.facts.originalTargetDate);
  const assessment = task.facts.savedCents === null && !calculated.constraintViolations.length ? { ...calculated,
    status: 'insufficient_data' as const, projectedDate: null, dataSufficient: false } : calculated;
  if (state.finance.historyMonths < 2) gaps.push('模拟历史不足 2 个月，不能保证按期完成');
  if (task.facts.savedCents === null) gaps.push('用户尚未确认已存金额；暂按零试算');
  if (!state.dataConnections.some(item => item.status === 'connected'))
    gaps.push('尚未连接模拟流水来源，支出分类证据有限');
  if (task.preferences.some(item => item.value.includes('健身')))
    gaps.push('健身支出偏好已保留，当前汇总数据不能单独验证该分类');
  if (scenario.kind === 'current_month_expense') assumptions.push('额外支出只影响当前模拟月份');
  if (ongoing) assumptions.push(`变化从第 ${(scenario.startMonthIndex ?? 0) + 1} 个模拟月份起持续发生`);
  if (missed) assumptions.push(`第 ${scenario.monthIndex! + 1} 个模拟月份不投入目标资金，其余月份保持原计划`);
  return { status: assessment.constraintViolations.length ? 'constraint_violation' as const
    : assessment.dataSufficient ? 'ok' as const : 'insufficient_data' as const,
  errorCode: assessment.constraintViolations[0] ?? null,
  output: { input, assessment, previewId: preview?.id ?? null }, sources, assumptions, gaps };
}

export function runAgentReadTool(sessionId: string, threadId: string, name: string,
  rawInput: unknown): AgentToolResult {
  const input = validatedInput(name, rawInput);
  let task = getAgentTaskForThread(sessionId, threadId);
  if (!task || task.readOnly || task.phase === 'completed' || task.phase === 'failed' || task.phase === 'paused')
    throw new Error('READ_TOOL_TASK_NOT_ACTIVE');
  const state = getState(sessionId);
  if (task.baseTwinVersion !== state.twinVersion)
    task = updateAgentTask(sessionId, task.taskId, task.taskRevision,
      { baseTwinVersion: state.twinVersion, evidenceRefs: [] });
  if (name === 'repair_stressed_goal_option') {
    const args = RepairStressedGoalOptionInputSchema.parse(input);
    if (!task.evidenceRefs.includes(args.stressTestResultId))
      throw new Error('READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED');
    const [batch, stress] = referencedResults(sessionId, threadId, task.taskId, task.demoRunId,
      state.twinVersion, [args.stressTestResultId, args.stressResultId], state);
    if (batch.tool !== 'stress_test_goal_options' || stress.tool !== 'candidate_preview')
      throw new Error('READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED');
    const row = batch.output.results.find(item => item.stressResultId === args.stressResultId);
    if (!row || row.outcome !== 'fails' || !task.candidateRefs.includes(row.baselineResultId))
      throw new Error('READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED');
    const baseline = referencedResults(sessionId, threadId, task.taskId, task.demoRunId,
      state.twinVersion, [row.baselineResultId], state)[0];
    if (baseline.tool !== 'candidate_preview' || baseline.status !== 'ok' ||
      baseline.output.input.scenario.kind !== 'baseline' || !baseline.output.assessment ||
      JSON.stringify(stress.output.input.scenario) !== JSON.stringify(row.scenario) ||
      !stress.sourceEntities.some(item => item.kind === 'tool_result' && item.id === row.baselineResultId))
      throw new Error('READ_TOOL_REPAIR_EVIDENCE_NOT_ALLOWED');
    const search = searchStressRepair(state, task, baseline.output.input, row);
    if (getState(sessionId).twinVersion !== state.twinVersion ||
      !getAgentTaskForThread(sessionId, threadId)?.candidateRefs.includes(row.baselineResultId))
      throw new Error('READ_TOOL_REPAIR_STALE');
    const summary = AgentToolResultSchema.parse({ toolResultId: randomUUID(), taskId: task.taskId,
      threadId, demoRunId: task.demoRunId, twinVersion: state.twinVersion,
      dataAsOf: state.finance.updatedAt, createdAt: new Date().toISOString(),
      tool: 'repair_stressed_goal_option', status: 'ok', errorCode: null,
      sourceEntities: [{ kind: 'task', id: task.taskId }, { kind: 'finance', id: 'finance' },
        ...[batch, baseline, stress].map(item => ({ kind: 'tool_result', id: item.toolResultId }))],
      assumptions: ['每次只改变一个条件；目标金额和保护资金保持不变',
        '月存调整不超过用户上限和当前基线可投入额；日期调整不超过用户允许的最晚日期',
        '这是模拟修复建议，未修改正式计划'],
      gaps: search.status === 'none_within_constraints' ? ['当前允许的月存与日期范围内未找到修复'] : [],
      output: { input: args, baselineResultId: row.baselineResultId, scenario: row.scenario, ...search } });
    const key = createHash('sha256').update(JSON.stringify({ name, input: args, state,
      facts: task.facts, constraints: task.constraints, preferences: task.preferences })).digest('hex');
    const saved = saveAgentToolResult(sessionId, summary, key);
    const current = getAgentTaskForThread(sessionId, threadId)!;
    if (!current.evidenceRefs.includes(saved.toolResultId)) updateAgentTask(sessionId, current.taskId,
      current.taskRevision, { evidenceRefs: [...current.evidenceRefs.slice(-99), saved.toolResultId],
        runRecord: { id: randomUUID(), kind: 'tool_completed', summary: `repair_stressed_goal_option: ${search.status}`,
          at: new Date().toISOString(), toolResultId: saved.toolResultId } });
    return saved;
  }
  if (name === 'stress_test_goal_options') {
    const args = StressTestGoalOptionsInputSchema.parse(input);
    if (new Set(args.candidateResultIds).size !== args.candidateResultIds.length ||
      new Set(args.scenarios.map(item => JSON.stringify(item))).size !== args.scenarios.length)
      throw new Error('READ_TOOL_STRESS_DUPLICATE');
    for (const scenario of args.scenarios) {
      const max = scenario.kind === 'current_month_expense' ? state.finance.checkingCents
        : scenario.kind === 'monthly_income_reduction' ? state.finance.monthlyIncomeCents
          : scenario.kind === 'monthly_essential_spending_increase' ? state.finance.monthlyIncomeCents : null;
      if (max !== null && 'amountCents' in scenario && scenario.amountCents > max)
        throw new Error('READ_TOOL_STRESS_AMOUNT_OUT_OF_RANGE');
    }
    const baselines = args.candidateResultIds.map(id => {
      if (!task.candidateRefs.includes(id)) throw new Error('READ_TOOL_STRESS_CANDIDATE_NOT_ALLOWED');
      const result = referencedResults(sessionId, threadId, task.taskId, task.demoRunId,
        state.twinVersion, [id], state)[0];
      if (result.tool !== 'candidate_preview' || result.status !== 'ok' ||
        result.output.input.scenario.kind !== 'baseline' || !result.output.assessment?.dataSufficient ||
        result.output.assessment.bufferCents < 0 ||
        !['on_track', 'at_risk'].includes(result.output.assessment.status))
        throw new Error('READ_TOOL_STRESS_CANDIDATE_NOT_ALLOWED');
      return result;
    });
    // Validate every pair before materializing any result, so an invalid month cannot leave a partial batch.
    for (const baseline of baselines) for (const scenario of args.scenarios) {
      const horizon = Math.max(1, Math.ceil((Date.parse(`${baseline.output.input.targetDate}T00:00:00Z`) -
        Date.parse(`${state.clock}T00:00:00Z`)) / 86_400_000 / 30));
      if (('monthIndex' in scenario && scenario.monthIndex >= horizon) ||
        ('startMonthIndex' in scenario && scenario.startMonthIndex !== undefined &&
          scenario.startMonthIndex >= horizon)) throw new Error('READ_TOOL_INVALID_SCENARIO');
    }
    const results = baselines.flatMap(baseline => args.scenarios.map(scenario => {
      const stress = runAgentReadTool(sessionId, threadId, 'candidate_preview', {
        ...baseline.output.input, scenario, evidenceResultIds: [baseline.toolResultId],
      });
      if (stress.tool !== 'candidate_preview' || !stress.output.assessment ||
        !baseline.output.assessment) throw new Error('READ_TOOL_STRESS_RESULT_INVALID');
      const assessed = stress.output.assessment;
      const reasons: Array<'PROJECTED_AFTER_TARGET' | 'NO_PROJECTED_DATE' |
        'FIRST_MONTH_SHORTFALL' | 'TARGET_SHORTFALL' | 'INSUFFICIENT_DATA'> = [];
      if (!assessed.dataSufficient) reasons.push('INSUFFICIENT_DATA');
      if (assessed.projectedDate === null) reasons.push('NO_PROJECTED_DATE');
      else if (assessed.projectedDate > baseline.output.input.targetDate) reasons.push('PROJECTED_AFTER_TARGET');
      if (assessed.bufferCents < 0) reasons.push('FIRST_MONTH_SHORTFALL');
      if (assessed.shortfallCents > 0) reasons.push('TARGET_SHORTFALL');
      return { baselineResultId: baseline.toolResultId, stressResultId: stress.toolResultId,
        scenario, baseline: baseline.output.assessment, stressed: assessed,
        outcome: !assessed.dataSufficient ? 'insufficient_data' as const
          : reasons.length ? 'fails' as const : 'holds' as const, failureReasons: reasons };
    }));
    const current = getAgentTaskForThread(sessionId, threadId);
    if (!current || current.taskId !== task.taskId || current.demoRunId !== task.demoRunId ||
      getState(sessionId).twinVersion !== state.twinVersion ||
      JSON.stringify([current.facts, current.constraints, current.preferences]) !==
        JSON.stringify([task.facts, task.constraints, task.preferences]) ||
      !args.candidateResultIds.every(id => current.candidateRefs.includes(id)))
      throw new Error('READ_TOOL_STRESS_STALE');
    const summary = AgentToolResultSchema.parse({ toolResultId: randomUUID(), taskId: task.taskId,
      threadId, demoRunId: task.demoRunId, twinVersion: state.twinVersion,
      dataAsOf: state.finance.updatedAt, createdAt: new Date().toISOString(),
      tool: 'stress_test_goal_options', status: results.some(item => item.outcome === 'insufficient_data')
        ? 'insufficient_data' : 'ok', errorCode: results.some(item => item.outcome === 'insufficient_data')
        ? 'READ_TOOL_DATA_INSUFFICIENT' : null,
      sourceEntities: [{ kind: 'task', id: task.taskId }, { kind: 'finance', id: 'finance' },
        ...baselines.map(item => ({ kind: 'tool_result', id: item.toolResultId })),
        ...results.map(item => ({ kind: 'tool_result', id: item.stressResultId }))],
      assumptions: ['压力金额与发生月份是调用方给出的有界假设，并非收入或支出的预测',
        '所有情景沿用基线目标、月存金额、保护资金和当前模拟财务版本'],
      gaps: results.some(item => item.outcome === 'insufficient_data') ? ['部分压力情景缺少充分数据'] : [],
      output: { input: args, scenarioBasis: 'bounded_hypothesis', results } });
    const key = createHash('sha256').update(JSON.stringify({ name, input: args, state,
      facts: task.facts, constraints: task.constraints, preferences: task.preferences })).digest('hex');
    const saved = saveAgentToolResult(sessionId, summary, key);
    const latest = getAgentTaskForThread(sessionId, threadId)!;
    if (!latest.evidenceRefs.includes(saved.toolResultId)) updateAgentTask(sessionId, latest.taskId,
      latest.taskRevision, { evidenceRefs: [...latest.evidenceRefs.slice(-99), saved.toolResultId],
        runRecord: { id: randomUUID(), kind: 'tool_completed', summary: `stress_test_goal_options: ${saved.status}`,
          at: new Date().toISOString(), toolResultId: saved.toolResultId } });
    return saved;
  }
  if (name === 'search_goal_options') {
    const args = SearchGoalOptionsInputSchema.parse(input);
    const search = searchGoalOptions(state, task, args.objective, args.maxResults);
    const protectedCents = Math.max(task.constraints.protectedCents ?? 0, state.finance.emergencyCents);
    const candidates = search.options.map(option => runAgentReadTool(sessionId, threadId, 'candidate_preview', {
      targetCents: task.facts.targetCents!, targetDate: task.facts.originalTargetDate!,
      monthlyContributionCents: option.monthlyContributionCents, protectedCents,
      ...(option.firstMonthContributionCents !== undefined
        ? { firstMonthContributionCents: option.firstMonthContributionCents } : {}),
      scenario: { kind: 'baseline' }, evidenceResultIds: [],
    }));
    if (getState(sessionId).twinVersion !== state.twinVersion)
      throw new Error('READ_TOOL_SEARCH_STALE');
    const summary = AgentToolResultSchema.parse({ toolResultId: randomUUID(), taskId: task.taskId,
      threadId, demoRunId: task.demoRunId, twinVersion: state.twinVersion,
      dataAsOf: state.finance.updatedAt, createdAt: new Date().toISOString(),
      tool: 'search_goal_options', status: search.status === 'insufficient_data' ? 'insufficient_data' : 'ok',
      errorCode: search.status === 'insufficient_data' ? 'READ_TOOL_DATA_INSUFFICIENT' : null,
      sourceEntities: [{ kind: 'task', id: task.taskId }, { kind: 'finance', id: 'finance' },
        ...candidates.map(item => ({ kind: 'tool_result', id: item.toolResultId }))],
      assumptions: ['固定月存基线；目标金额与日期、月存上限和保护资金保持用户设定',
        '首月缓冲为负的固定月存候选不作为可直接选择的方案'],
      gaps: search.gaps, output: { objective: args.objective,
        searchedRangeCents: search.searchedRangeCents, evaluatedCount: search.evaluatedCount,
        candidateResultIds: candidates.map(item => item.toolResultId), excluded: search.excluded } });
    const key = createHash('sha256').update(JSON.stringify({ name, input: args, state,
      facts: task.facts, constraints: task.constraints, preferences: task.preferences })).digest('hex');
    const saved = saveAgentToolResult(sessionId, summary, key);
    const current = getAgentTaskForThread(sessionId, threadId)!;
    if (!current.evidenceRefs.includes(saved.toolResultId)) updateAgentTask(sessionId, current.taskId,
      current.taskRevision, { evidenceRefs: [...current.evidenceRefs.slice(-99), saved.toolResultId],
        runRecord: { id: randomUUID(), kind: 'tool_completed', summary: `search_goal_options: ${search.status}`,
          at: new Date().toISOString(), toolResultId: saved.toolResultId } });
    return saved;
  }
  const dedupeKey = createHash('sha256').update(JSON.stringify({ name, input, state,
    facts: task.facts, constraints: task.constraints, preferences: task.preferences })).digest('hex');
  const base = { toolResultId: randomUUID(), taskId: task.taskId, threadId, demoRunId: task.demoRunId,
    twinVersion: state.twinVersion, dataAsOf: state.finance.updatedAt,
    createdAt: new Date().toISOString() };
  let result: AgentToolResult;
  if(['bill_period_summary','spending_baseline_comparison','subscription_candidates','evidence_detail','dated_cashflow_forecast'].includes(name)){
    const calculated=runBankingTool(state,name as Parameters<typeof runBankingTool>[1],input).result;
    result=AgentToolResultSchema.parse({...base,tool:name,status:name==='dated_cashflow_forecast'&&calculated.precision!=='exact'?'insufficient_data':'ok',errorCode:name==='dated_cashflow_forecast'&&calculated.precision!=='exact'?'READ_TOOL_DATA_INSUFFICIENT':null,sourceEntities:state.transactions.slice(0,100).map(t=>({kind:'transaction',id:t.id})),assumptions:['金额、日期与证据由服务端确定性核算。'],gaps:[],output:calculated});
  } else if (name === 'financial_overview') {
    const { checkingCents, emergencyCents, monthlyIncomeCents, fixedBillsCents,
      essentialSpendingCents, historyMonths } = state.finance;
    result = AgentToolResultSchema.parse({ ...base, tool: name, status: historyMonths < 2 ? 'insufficient_data' : 'ok',
      errorCode: historyMonths < 2 ? 'READ_TOOL_DATA_INSUFFICIENT' : null,
      sourceEntities: [{ kind: 'finance', id: 'finance' }, ...state.accounts.map(item => ({ kind: 'account', id: item.id }))],
      assumptions: ['可用于目标的月额扣除固定账单和必要支出，不包含应急金'],
      gaps: historyMonths < 2 ? ['模拟历史不足 2 个月'] : [],
      output: { checkingCents, emergencyCents, monthlyIncomeCents, fixedBillsCents,
        essentialSpendingCents, availableMonthlyCents: availableMonthly(state), historyMonths } });
  } else if (name === 'essential_bills') {
    result = AgentToolResultSchema.parse({ ...base, tool: name, status: 'ok', errorCode: null,
      sourceEntities: [{ kind: 'finance', id: 'finance' }, ...state.bills.map(item => ({ kind: 'bill', id: item.id }))],
      assumptions: ['固定账单汇总和必要支出取当前模拟财务状态'], gaps: [],
      output: { fixedBillsCents: state.finance.fixedBillsCents,
        essentialSpendingCents: state.finance.essentialSpendingCents, bills: state.bills.slice(0, 100) } });
  } else if (name === 'relevant_transactions') {
    const args = TransactionsInput.parse(input);
    const transactions = state.transactions.filter(item => !args.category || item.category === args.category)
      .slice(0, args.limit);
    result = AgentToolResultSchema.parse({ ...base, tool: name, status: 'ok', errorCode: null,
      sourceEntities: transactions.map(item => ({ kind: 'transaction', id: item.id })),
      assumptions: ['只返回当前会话的模拟流水，最多 30 条'],
      gaps: transactions.length ? [] : ['没有匹配的模拟流水'],
      output: { transactions, category: args.category ?? null } });
  } else if (name === 'data_sufficiency') {
    const connected = state.dataConnections.filter(item => item.status === 'connected');
    const sufficient = state.finance.historyMonths >= 2;
    result = AgentToolResultSchema.parse({ ...base, tool: name, status: sufficient ? 'ok' : 'insufficient_data',
      errorCode: sufficient ? null : 'READ_TOOL_DATA_INSUFFICIENT',
      sourceEntities: [{ kind: 'finance', id: 'finance' },
        ...connected.map(item => ({ kind: 'connection', id: item.id }))], assumptions: [],
      gaps: sufficient ? [] : ['模拟历史不足 2 个月'], output: {
        sufficient, historyMonths: state.finance.historyMonths, connectedSources: connected.map(item => item.source),
        coverageStart: connected.map(item => item.coverageStart).filter((v): v is string => !!v).sort()[0] ?? null,
        coverageEnd: connected.map(item => item.coverageEnd).filter((v): v is string => !!v).sort().at(-1) ?? null,
      } });
  } else {
    const calculated = candidateResult(sessionId, threadId, CandidateInputSchema.parse(input), state, task);
    result = AgentToolResultSchema.parse({ ...base, tool: 'candidate_preview', status: calculated.status,
      errorCode: calculated.errorCode, sourceEntities: calculated.sources,
      assumptions: calculated.assumptions, gaps: calculated.gaps, output: calculated.output });
  }
  const saved = saveAgentToolResult(sessionId, result, dedupeKey);
  const refField = saved.tool === 'candidate_preview' && saved.status === 'ok' &&
    saved.output.input.scenario.kind === 'baseline' ? 'candidateRefs' : 'evidenceRefs';
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = getAgentTaskForThread(sessionId, threadId)!;
    if (current[refField].includes(saved.toolResultId)) return saved;
    const phase = saved.tool === 'candidate_preview' && current.phase === 'investigating' ? 'simulating'
      : current.phase === 'understanding' || current.phase === 'awaiting_user' ? 'investigating' : current.phase;
    try {
      updateAgentTask(sessionId, current.taskId, current.taskRevision, { phase,
        waitingReason: phase === 'investigating' || phase === 'simulating' ? null : current.waitingReason,
        [refField]: [...current[refField].slice(refField === 'candidateRefs' ? -29 : -99), saved.toolResultId],
        runRecord: { id: randomUUID(), kind: 'tool_completed', summary: `${name}: ${saved.status}`,
          at: new Date().toISOString(), toolResultId: saved.toolResultId } });
      return saved;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'TASK_REVISION_CONFLICT' || attempt === 2) throw error;
    }
  }
  return saved;
}
