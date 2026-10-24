import type { AgentTask, AgentToolResult, CandidateAssessment, CandidateInput,
  DemoState } from '../shared/contracts.ts';
import { assessCandidateScenario, availableMonthly } from './domain.ts';

type StressRow = Extract<AgentToolResult, { tool: 'stress_test_goal_options' }>['output']['results'][number];
type RepairOutput = Extract<AgentToolResult, { tool: 'repair_stressed_goal_option' }>['output'];
const DAY = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const isoDay = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

export function searchStressRepair(state: DemoState, task: AgentTask, baseline: CandidateInput,
  row: StressRow): Pick<RepairOutput, 'status' | 'searchedBounds' | 'evaluatedCount' |
    'repairs' | 'unavailableReasons'> {
  const originalDay = dayNumber(baseline.targetDate);
  const latestAllowedDate = task.constraints.latestAllowedDate ?? task.facts.originalTargetDate!;
  const latestDay = Math.max(originalDay, dayNumber(latestAllowedDate));
  const firstMonthLimit = row.scenario.kind === 'missed_contribution_once' && row.scenario.monthIndex === 0
    ? Number.MAX_SAFE_INTEGER : row.stressed.firstMonthCapacityCents;
  const monthlyMax = Math.max(0, Math.min(task.constraints.monthlyContributionCapCents ?? availableMonthly(state),
    availableMonthly(state), firstMonthLimit));
  const repairs: RepairOutput['repairs'] = [];
  const unavailableReasons: RepairOutput['unavailableReasons'] = [];
  let evaluatedCount = 0;
  const evaluate = (monthlyContributionCents: number, targetDate: string): CandidateAssessment => {
    evaluatedCount++;
    return assessCandidateScenario(state, { ...baseline, monthlyContributionCents, targetDate,
      scenario: row.scenario, evidenceResultIds: [] }, task.facts.savedCents!, [], latestAllowedDate);
  };
  const works = (assessment: CandidateAssessment, targetDate: string) =>
    assessment.dataSufficient && !assessment.constraintViolations.length &&
    assessment.projectedDate !== null && assessment.projectedDate <= targetDate &&
    assessment.shortfallCents === 0 && assessment.bufferCents >= 0;

  if (monthlyMax > baseline.monthlyContributionCents &&
    works(evaluate(monthlyMax, baseline.targetDate), baseline.targetDate)) {
    let low = baseline.monthlyContributionCents + 1;
    let high = monthlyMax;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      if (works(evaluate(mid, baseline.targetDate), baseline.targetDate)) high = mid;
      else low = mid + 1;
    }
    const assessment = evaluate(low, baseline.targetDate);
    repairs.push({ kind: 'monthly_contribution_increase', proposedMonthlyContributionCents: low,
      increaseCents: low - baseline.monthlyContributionCents, assessment });
  } else unavailableReasons.push(row.failureReasons.includes('FIRST_MONTH_SHORTFALL')
    ? 'FIRST_MONTH_CAPACITY' : 'MONTHLY_LIMIT');

  if (latestDay > originalDay && works(evaluate(baseline.monthlyContributionCents,
    isoDay(latestDay)), isoDay(latestDay))) {
    let low = originalDay + 1;
    let high = latestDay;
    while (low < high) {
      const mid = low + Math.floor((high - low) / 2);
      const date = isoDay(mid);
      if (works(evaluate(baseline.monthlyContributionCents, date), date)) high = mid;
      else low = mid + 1;
    }
    const proposedTargetDate = isoDay(low);
    repairs.push({ kind: 'deadline_extension', proposedTargetDate,
      extensionDays: low - originalDay,
      assessment: evaluate(baseline.monthlyContributionCents, proposedTargetDate) });
  } else unavailableReasons.push('DEADLINE_LIMIT');

  if (!repairs.length) unavailableReasons.push('NO_REPAIR_IN_SEARCH_BOUNDS');
  return { status: repairs.length ? 'repair_found' : 'none_within_constraints',
    searchedBounds: { monthlyContributionMaxCents: monthlyMax, latestAllowedDate },
    evaluatedCount, repairs, unavailableReasons };
}
