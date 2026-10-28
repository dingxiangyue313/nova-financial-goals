import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { GoalPlanOptionSchema, type DemoState } from '../shared/contracts.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans } from './money-mission-plans.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { createFixture } from './fixtures.ts';
import { activatePlan, assessGoal } from './domain.ts';
import { searchGoalOptions } from './goal-option-search.ts';
import { previewGoalScenario } from './scenario.ts';
import { runAgentReadTool } from './agent-read-tools.ts';
import { prepareCandidateConfirmation } from './workspace.ts';
import { createAgentRun, createAgentThread, getAgentTaskForThread, getAgentToolResult, getState,
  mutateState, saveAgentMessage, saveGoalDraft, updateAgentRun, updateAgentTask } from './store.ts';

const forecastFor = (state: DemoState) => buildDatedCashflowForecast(state,
  { accountId: 'checking', horizonEnd: state.goal.targetDate, scenario: 'baseline' });

function setup(state = createJapanMoneyMissionFixture(), monthlyContributionCapCents = 120000) {
  const sessionId = randomUUID();
  mutateState(sessionId, () => state);
  const thread = createAgentThread(sessionId, { title: state.goal.title });
  saveGoalDraft(sessionId, { id: randomUUID(), threadId: thread.id, goalId: state.goal.id,
    title: state.goal.title, targetCents: state.goal.targetCents, targetDate: state.goal.targetDate,
    savedCents: state.goal.savedCents, monthlyContributionCapCents,
    protectedCents: state.goal.protectedCents, flexibilityWeeks: 0, fieldSources: {},
    missingRequiredFields: [], updatedAt: new Date().toISOString() });
  return { sessionId, threadId: thread.id, task: getAgentTaskForThread(sessionId, thread.id)! };
}

function recommend(sessionId: string, threadId: string, ids: string[]) {
  const message = saveAgentMessage(sessionId, threadId, { role: 'user', content: '选择方案', components: [] });
  const run = createAgentRun(sessionId, threadId, message.id);
  updateAgentRun(sessionId, threadId, run.runId, run.revision, { status: 'completed', recommendedResultIds: ids });
  const task = getAgentTaskForThread(sessionId, threadId)!;
  updateAgentTask(sessionId, task.taskId, task.taskRevision, { phase: 'awaiting_user', waitingReason: 'user_choice' });
}

test('Japan fixture produces three materially different and arithmetically exact plans', () => {
  const state = createJapanMoneyMissionFixture();
  const forecast = forecastFor(state); const before = structuredClone(state);
  const plans = buildMoneyMissionPlans(state, forecast);
  const [steady, balanced, accelerated] = plans;
  assert.deepEqual([steady.monthlyCents, steady.occurrences, steady.projectedDate], [75000, 8, '2027-06-26']);
  assert.deepEqual([balanced.monthlyCents, balanced.occurrences, balanced.projectedDate], [100000, 6, '2027-04-26']);
  assert.deepEqual([accelerated.upfrontCents, accelerated.monthlyCents, accelerated.occurrences,
    accelerated.projectedDate], [120000, 120000, 4, '2027-02-26']);
  assert.equal(plans.length, 3);
  assert.deepEqual(plans.map(plan => plan.firstMonthContributionCents), [75000, 100000, 120000]);
  for (const plan of plans) {
    assert.equal(plan.upfrontCents + plan.monthlyCents * plan.occurrences, 600000);
    assert.equal(plan.executable, true);
    assert.equal(plan.forecastId, forecast.id);
    assert.equal(plan.twinVersion, state.twinVersion);
    assert.ok(plan.evidenceRefs.includes(forecast.id));
    assert.ok(GoalPlanOptionSchema.safeParse(plan).success);
  }
  assert.deepEqual(plans.map(plan => plan.minimumBalanceCents), [317200, 317200, 197200]);
  assert.deepEqual(buildMoneyMissionPlans(state, forecast), plans);
  assert.deepEqual(state, before);
  assert.equal(state.accounts.find(account => account.id === 'emergency')!.balanceCents, 2000000);
  assert.equal(state.goal.savedCents, 200000);
});

test('plans consume edited dated events instead of the monthly finance aggregate', () => {
  const state = createJapanMoneyMissionFixture();
  const edited = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: state.goal.targetDate,
    scenario: 'edited', edits: [{ type: 'add', event: { id: 'large-purchase', date: '2026-11-02',
      label: '已知采购', kind: 'purchase', amountCents: -400000, currency: 'CNY', sourceRefs: ['purchase'] } }] });
  const plans = buildMoneyMissionPlans(state, edited);
  assert.ok(plans.every(plan => !plan.executable));
  assert.ok(plans.every(plan => plan.minimumBalanceCents! < 0));
  assert.notEqual(plans[1].id, buildMoneyMissionPlans(state, forecastFor(state))[1].id);
});

test('range forecasts offer recommendations without exact balances or activation authority', () => {
  const state = createJapanMoneyMissionFixture(); state.accountSnapshots = [];
  const forecast = forecastFor(state);
  const plans = buildMoneyMissionPlans(state, forecast);
  assert.equal(forecast.precision, 'range');
  assert.ok(plans.every(plan => !plan.executable && plan.minimumBalanceCents === null));
  assert.ok(plans.every(plan => plan.limitations.includes('AUTHORITATIVE_BALANCE_REQUIRED')));
  assert.throws(() => activatePlan(state, plans[1].id), /PLAN_NOT_AVAILABLE/);
  assert.equal(assessGoal(state).status, 'insufficient_data');
});

test('exact precision alone and stale forecasts cannot grant execution authority', () => {
  const state = createJapanMoneyMissionFixture(); const forecast = forecastFor(state);
  for (const invalid of [{ ...forecast, executableForecastId: null },
    { ...forecast, executableForecastId: 'another-forecast' }, { ...forecast, twinVersion: 2 },
    { ...forecast, dataAsOf: '2026-10-25' }]) {
    assert.ok(buildMoneyMissionPlans(state, invalid).every(plan => !plan.executable));
  }
});

test('extra protected checking reserves cannot be spent on any option', () => {
  const state = createJapanMoneyMissionFixture(); state.goal.protectedCents = 2400000;
  const plans = buildMoneyMissionPlans(state, forecastFor(state));
  assert.ok(plans.every(plan => !plan.executable));
  assert.ok(plans.every(plan => plan.limitations.includes('PROTECTED_FUNDS_UNAVAILABLE')));
});

test('a competing goal requires an explicit priority choice before either goal is executable', () => {
  const state = createJapanMoneyMissionFixture();
  const other = { ...state.goal, id: 'goal-home', title: '住房资金', targetCents: 10000000,
    monthlyContributionCents: 400000, status: 'active' as const };
  state.goals.push(other);
  assert.ok(buildMoneyMissionPlans(state, forecastFor(state)).every(plan =>
    !plan.executable && plan.limitations.includes('GOAL_PRIORITY_CONFLICT')));
  const second = { ...state, goal: other, goals: [{ ...state.goal, status: 'active' as const }, other] };
  assert.ok(buildMoneyMissionPlans(second, forecastFor(second)).every(plan =>
    !plan.executable && plan.limitations.includes('GOAL_PRIORITY_CONFLICT')));
  const { task } = setup(state);
  const search = searchGoalOptions(state, task);
  assert.equal(search.status, 'none_within_constraints');
  assert.equal(search.options.length, 0);
  assert.ok(search.gaps.includes('GOAL_PRIORITY_CONFLICT'));
});

test('a new draft cannot replace and hide the active primary goal reservation', () => {
  const state = createJapanMoneyMissionFixture();
  state.goal = { ...state.goal, status: 'active', monthlyContributionCents: 400000 };
  state.goals = [state.goal];
  const { task } = setup(state);
  const draftTask = { ...task, goalId: null, goalDraftId: 'second-goal-draft' };
  const search = searchGoalOptions(state, draftTask);
  assert.equal(search.options.length, 0);
  assert.ok(search.gaps.includes('GOAL_PRIORITY_CONFLICT'));
  const preview = previewGoalScenario(state, { targetCents: 800000, targetDate: '2027-06-30',
    monthlyContributionCents: 100000, protectedCents: 2000000, flexibilityWeeks: 0 },
  { id: 'second-goal-draft', title: '第二个目标', savedCents: 200000 });
  assert.equal(preview.assessment.status, 'infeasible');
});

test('short dated windows fail closed when frozen candidate amounts cannot identify the schedule', () => {
  const state = createJapanMoneyMissionFixture(); state.goal.targetDate = '2026-12-30';
  const { task } = setup(state);
  const search = searchGoalOptions(state, { ...task,
    constraints: { ...task.constraints, monthlyContributionCapCents: 400000 } });
  assert.equal(search.options.length, 0);
  assert.ok(search.gaps.includes('AMBIGUOUS_SCHEDULE'));
});

test('ambiguous upfront schedules cannot activate before or after an ordinary version change', () => {
  const state = createJapanMoneyMissionFixture(); state.goal.targetDate = '2026-12-30';
  for (const version of [1, 2]) {
    state.twinVersion = version;
    const plans = buildMoneyMissionPlans(state, forecastFor(state));
    assert.ok(plans.every(plan => !plan.executable && plan.limitations.includes('AMBIGUOUS_SCHEDULE')));
    for (const plan of plans) assert.throws(() => activatePlan(state, plan.id), /PLAN_NOT_AVAILABLE/);
  }
});

test('a representable accepted upfront schedule keeps its meaning when the forecast version changes', () => {
  const state = createJapanMoneyMissionFixture();
  const accelerated = buildMoneyMissionPlans(state, forecastFor(state))[2];
  const active = activatePlan(state, accelerated.id);
  assert.equal(assessGoal(active).projectedDate, '2027-02-26');
  active.twinVersion++;
  assert.equal(assessGoal(active).projectedDate, '2027-02-26');
});

test('correcting payroll to day 27 cannot drop upfront funding from an accepted accelerated schedule', () => {
  const state = createJapanMoneyMissionFixture();
  const accelerated = buildMoneyMissionPlans(state, forecastFor(state))[2];
  const active = activatePlan(state, accelerated.id);
  assert.equal(assessGoal(active).projectedDate, '2027-02-26');
  active.twinVersion++;
  active.transactions[0].date = '2026-09-27';
  const regenerated = buildMoneyMissionPlans(active, forecastFor(active))[2];
  assert.deepEqual([regenerated.upfrontCents, regenerated.monthlyCents, regenerated.occurrences,
    regenerated.firstMonthContributionCents, regenerated.projectedDate], [120000, 120000, 4, 240000, '2027-01-28']);
  const before = structuredClone(active);
  const result = assessGoal(active);
  assert.equal(result.status, 'infeasible');
  assert.equal(result.projectedDate, null);
  assert.ok(result.assumptions.includes('AMBIGUOUS_SCHEDULE'));
  assert.deepEqual(active, before);
});

test('first month totals include upfront and recurring deposits in the same calendar month', () => {
  const state = createJapanMoneyMissionFixture(); state.clock = '2026-10-20';
  state.accountSnapshots.forEach(snapshot => { snapshot.asOf = state.clock; });
  const accelerated = buildMoneyMissionPlans(state, forecastFor(state))[2];
  assert.equal(accelerated.upfrontCents, 120000);
  assert.equal(accelerated.monthlyCents, 120000);
  assert.equal(accelerated.firstMonthContributionCents, 240000);
  assert.equal(accelerated.projectedDate, '2027-01-26');
});

test('calendar first-month totals survive real search, candidate validation and frozen confirmation', () => {
  const state = createJapanMoneyMissionFixture(); state.clock = '2026-10-20';
  state.accountSnapshots.forEach(snapshot => { snapshot.asOf = state.clock; });
  const { sessionId, threadId } = setup(state, 240000);
  const result = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(result.tool, 'search_goal_options');
  if (result.tool !== 'search_goal_options') return;
  const candidates = result.output.candidateResultIds.map(id => getAgentToolResult(sessionId, threadId, id));
  const accelerated = candidates.find(item => item.tool === 'candidate_preview' &&
    item.output.input.monthlyContributionCents === 120000);
  assert.ok(accelerated); assert.equal(accelerated.tool, 'candidate_preview');
  if (accelerated.tool !== 'candidate_preview') return;
  assert.equal(accelerated.output.input.firstMonthContributionCents, 240000);
  assert.equal(accelerated.status, 'ok');
  assert.equal(accelerated.output.assessment?.projectedDate, '2027-01-26');
  recommend(sessionId, threadId, [accelerated.toolResultId]);
  const prepared = prepareCandidateConfirmation(sessionId, threadId, accelerated.toolResultId, getState(sessionId));
  assert.equal((prepared.action.payload.frozen as Record<string, unknown>).firstMonthContributionCents, 240000);
});

test('calendar first-month totals still obey the user cap and legacy validation stays unchanged', () => {
  const dated = createJapanMoneyMissionFixture(); dated.clock = '2026-10-20';
  dated.accountSnapshots.forEach(snapshot => { snapshot.asOf = dated.clock; });
  const { task } = setup(dated, 120000);
  const options = searchGoalOptions(dated, task).options;
  assert.ok(options.length > 0);
  assert.ok(options.every(option => option.firstMonthContributionCents! <= 120000));
  assert.ok(options.every(option => option.monthlyContributionCents !== 120000));
  for (const [state, cap, firstMonth] of [[createFixture(), 240000, 200000], [dated, 120000, 240000]] as const) {
    const { sessionId, threadId } = setup(state, cap);
    const result = runAgentReadTool(sessionId, threadId, 'candidate_preview', { targetCents: 800000,
      targetDate: state.goal.targetDate, monthlyContributionCents: 100000,
      firstMonthContributionCents: firstMonth, protectedCents: 2000000,
      scenario: { kind: 'baseline' }, evidenceResultIds: [] });
    assert.equal(result.status, 'constraint_violation');
    if (result.tool === 'candidate_preview')
      assert.ok(result.output.assessment?.constraintViolations.includes('FIRST_MONTH_CONTRIBUTION_INVALID'));
  }
});

for (const [targetDate, reason, status] of [
  ['2026-10-25', 'GOAL_DEADLINE_PASSED', 'none_within_constraints'],
  ['2028-06-30', 'FORECAST_HORIZON_INCOMPLETE', 'insufficient_data'],
] as const) test(`deadline ${targetDate} returns non-executable plans and a bounded search result`, () => {
  const state = createJapanMoneyMissionFixture(); state.goal.targetDate = targetDate;
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', scenario: 'baseline',
    horizonEnd: targetDate < state.clock ? state.clock : '2027-10-27' });
  const plans = buildMoneyMissionPlans(state, forecast);
  assert.ok(plans.every(plan => !plan.executable && plan.limitations.includes(reason)));
  const { task } = setup(state);
  const search = searchGoalOptions(state, task);
  assert.equal(search.status, status); assert.equal(search.options.length, 0);
  assert.ok(search.gaps.includes(reason));
});

test('scenario and search preserve the dated plan amounts and completion dates', () => {
  const state = createJapanMoneyMissionFixture(); const { task } = setup(state);
  const search = searchGoalOptions(state, task);
  assert.equal(search.status, 'options_found');
  assert.deepEqual(search.options.map(option => [option.monthlyContributionCents,
    option.firstMonthContributionCents, option.assessment.projectedDate]), [
    [75000, 75000, '2027-06-26'], [100000, 100000, '2027-04-26'], [120000, 120000, '2027-02-26'],
  ]);
  assert.equal(searchGoalOptions(state, task, 'earlier', 1).options[0].assessment.projectedDate, '2027-02-26');
  assert.equal(searchGoalOptions(state, task, 'lower_monthly', 1).options.length, 1);
  const preview = previewGoalScenario(state, { targetCents: 800000, targetDate: '2027-06-30',
    monthlyContributionCents: 100000, protectedCents: 2000000, flexibilityWeeks: 0 });
  assert.equal(preview.assessment.projectedDate, '2027-04-26');
  assert.deepEqual(preview.plans.map(plan => plan.projectedDate), ['2027-06-26', '2027-04-26', '2027-02-26']);
  assert.equal(activatePlan(state, preview.plans[1].id).goal.monthlyContributionCents, 100000);
});

test('dated search retains candidate result IDs and the frozen confirmation snapshot', () => {
  const { sessionId, threadId } = setup();
  const result = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(result.tool, 'search_goal_options');
  if (result.tool !== 'search_goal_options') return;
  const ids = result.output.candidateResultIds; assert.equal(ids.length, 3);
  const balanced = getAgentToolResult(sessionId, threadId, ids[1]);
  assert.equal(balanced.tool, 'candidate_preview');
  if (balanced.tool !== 'candidate_preview') return;
  assert.equal(balanced.output.assessment?.projectedDate, '2027-04-26');
  recommend(sessionId, threadId, ids);
  const prepared = prepareCandidateConfirmation(sessionId, threadId, ids[1], getState(sessionId));
  assert.equal(prepared.action.actionType, 'apply_verified_candidate');
  assert.equal((prepared.action.payload.frozen as Record<string, unknown>).firstMonthContributionCents, 100000);
  assert.match(prepared.component.body ?? '', /1,000|1000/);
});

test('missing balance cannot turn a read-only search candidate into an activation confirmation', () => {
  const state = createJapanMoneyMissionFixture(); state.accountSnapshots = [];
  const { sessionId, threadId } = setup(state);
  const search = runAgentReadTool(sessionId, threadId, 'search_goal_options', {});
  assert.equal(search.status, 'insufficient_data');
  if (search.tool !== 'search_goal_options') return;
  recommend(sessionId, threadId, search.output.candidateResultIds);
  for (const id of search.output.candidateResultIds) {
    assert.equal(getAgentToolResult(sessionId, threadId, id).status, 'insufficient_data');
    assert.throws(() => prepareCandidateConfirmation(sessionId, threadId, id, getState(sessionId)), /CANDIDATE_NOT_CURRENT|CANDIDATE_NOT_APPLICABLE/);
  }
});
