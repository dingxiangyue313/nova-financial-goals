import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentExplanationSchema, explanationGroundingIssues, type ExplanationInput } from './agent-explanation.ts';

const input: ExplanationInput = {
  goal: { title: '旅行', targetAmountText: '¥8,000', savedAmountText: '¥2,000', targetDate: '2027-06-30' },
  constraints: { monthlyCapText: '¥1,600', protectedAmountText: '¥20,000',
    latestAllowedDate: null, preference: '轻松一点' },
  financialOverview: { monthlyIncomeText: '¥9,000', fixedBillsText: '¥3,500',
    essentialSpendingText: '¥2,700', availableMonthlyText: '¥2,800',
    firstMonthCapacityText: '¥2,800', source: '当前模拟财务数据' },
  candidates: [{ resultId: 'verified-1', monthlyText: '¥1,000', projectedDate: '2027-06-30',
    firstMonthBufferText: '¥1,800', status: 'on_track' }], dataGaps: [],
};

const valid = AgentExplanationSchema.parse({
  headline: '按当前模拟数据，预计能在 2027-06-30 前完成。',
  cashFlowBasis: '每月可投入 ¥2,800，选择 ¥1,000 的节奏后仍有缓冲。',
  options: [{ resultId: 'verified-1', positioning: '较轻松的月存节奏',
    numbersAndMeaning: '每月 ¥1,000，预计 2027-06-30 完成，首月缓冲 ¥1,800。',
    everydayLife: '每个月先留出目标款项，日常仍有一定周转空间。',
    advantage: '月存压力较低，缓冲较多。', tradeoff: '时间余量较少，需要持续执行。',
    failureConditions: ['若某月漏存，预计完成日期可能改变。'] }],
  comparison: '目前只有一个已核验候选，选择空间较有限。',
  recommendation: '若你能接受当前节奏，可以考虑该方案，选择后仍需确认。',
  recommendedResultId: 'verified-1', uncertainties: ['未来支出上升可能影响按时完成。'],
  reflectionQuestion: '你是否愿意按这个节奏持续留出目标款项？',
});

test('explanation grounding accepts only verified candidate facts', () => {
  assert.deepEqual(explanationGroundingIssues(valid, input), []);
  assert.deepEqual(explanationGroundingIssues({ ...valid, recommendedResultId: 'invented' }, input),
    ['RECOMMENDATION_ID']);
  assert.deepEqual(explanationGroundingIssues({ ...valid, headline: '预计 2027-05-01 完成。' }, input),
    ['UNEXPECTED_VALUE:2027-05-01']);
  assert.deepEqual(explanationGroundingIssues({ ...valid, headline: '还需要 ¥9,999。' }, input),
    ['UNEXPECTED_VALUE:¥9,999']);
  assert.deepEqual(explanationGroundingIssues({ ...valid, headline: '预计早十天完成。' }, input),
    ['DERIVED_DURATION:十天']);
  assert.deepEqual(explanationGroundingIssues({ ...valid, options: [{ ...valid.options[0], resultId: 'invented' }] }, input),
    ['CANDIDATE_IDS']);
});
