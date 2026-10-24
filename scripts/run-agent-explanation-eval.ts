import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assessCandidateScenario, availableMonthly } from '../server/domain.ts';
import { createFixture } from '../server/fixtures.ts';
import { explainAgentCandidates, explanationGroundingIssues, type ExplanationInput } from '../server/agent-explanation.ts';
import type { CandidateInput } from '../shared/contracts.ts';

if (!process.argv.includes('--real') || !process.env.DEEPSEEK_API_KEY) {
  console.log('用 --real 且仅在本机服务端配置 DeepSeek Key 后运行 20 案例评测。');
  process.exit(0);
}

type Scenario = { id: string; label: string; title: string; targetCents: number; savedCents: number;
  targetDate: string; monthlyCapCents: number; incomeCents: number; fixedBillsCents?: number;
  essentialSpendingCents?: number; checkingCents?: number; currentExpenseCents?: number;
  protectedCents?: number; historyMonths?: number; preference?: string | null };
const scenarios: Scenario[] = [
  { id: '01', label: '三方案，偏好低月存', title: '日本旅行', targetCents: 600000, savedCents: 200000, targetDate: '2027-03-31', monthlyCapCents: 200000, incomeCents: 1000000, preference: '希望每个月存得轻松一点' },
  { id: '02', label: '三方案，偏好提前完成', title: '旅行基金', targetCents: 600000, savedCents: 100000, targetDate: '2027-04-30', monthlyCapCents: 250000, incomeCents: 1100000, preference: '希望尽可能早完成' },
  { id: '03', label: '三方案，偏好高缓冲', title: '学习计划', targetCents: 500000, savedCents: 50000, targetDate: '2027-05-31', monthlyCapCents: 220000, incomeCents: 1050000, preference: '尽量保留日常现金流缓冲' },
  { id: '04', label: '单方案，月存上限紧', title: '日本旅行', targetCents: 800000, savedCents: 0, targetDate: '2026-12-31', monthlyCapCents: 200000, incomeCents: 900000 },
  { id: '05', label: '现金流上限紧', title: '相机', targetCents: 600000, savedCents: 200000, targetDate: '2026-12-31', monthlyCapCents: 300000, incomeCents: 850000 },
  { id: '06', label: '无方案，期限太近', title: '相机', targetCents: 1200000, savedCents: 0, targetDate: '2026-10-15', monthlyCapCents: 100000, incomeCents: 900000 },
  { id: '07', label: '无方案，收入下降', title: '旅行基金', targetCents: 800000, savedCents: 0, targetDate: '2026-12-31', monthlyCapCents: 200000, incomeCents: 750000 },
  { id: '08', label: '模拟历史不足', title: '教育储蓄', targetCents: 500000, savedCents: 100000, targetDate: '2027-04-30', monthlyCapCents: 180000, incomeCents: 950000, historyMonths: 1 },
  { id: '09', label: '已存金额较高', title: '相机', targetCents: 900000, savedCents: 700000, targetDate: '2027-01-31', monthlyCapCents: 180000, incomeCents: 950000 },
  { id: '10', label: '尚未存款', title: '旅行基金', targetCents: 800000, savedCents: 0, targetDate: '2027-06-30', monthlyCapCents: 200000, incomeCents: 1000000 },
  { id: '11', label: '本月已有额外支出', title: '装修准备金', targetCents: 700000, savedCents: 150000, targetDate: '2027-03-31', monthlyCapCents: 180000, incomeCents: 1050000, currentExpenseCents: 100000 },
  { id: '12', label: '保护金额高于应急金', title: '学习计划', targetCents: 500000, savedCents: 100000, targetDate: '2027-05-31', monthlyCapCents: 200000, incomeCents: 1050000, protectedCents: 2300000 },
  { id: '13', label: '用户上限降低', title: '日本旅行', targetCents: 650000, savedCents: 200000, targetDate: '2027-02-28', monthlyCapCents: 120000, incomeCents: 1100000, preference: '每月最多投入 ¥1,200' },
  { id: '14', label: '目标金额增加', title: '家庭旅行', targetCents: 1500000, savedCents: 200000, targetDate: '2027-06-30', monthlyCapCents: 300000, incomeCents: 1150000 },
  { id: '15', label: '较长准备期', title: '开店准备金', targetCents: 1800000, savedCents: 300000, targetDate: '2028-06-30', monthlyCapCents: 250000, incomeCents: 1000000 },
  { id: '16', label: '短准备期但已有存款', title: '相机', targetCents: 500000, savedCents: 400000, targetDate: '2026-10-15', monthlyCapCents: 200000, incomeCents: 1000000 },
  { id: '17', label: '必要支出上升', title: '旅行基金', targetCents: 750000, savedCents: 150000, targetDate: '2027-04-30', monthlyCapCents: 220000, incomeCents: 1000000, essentialSpendingCents: 360000 },
  { id: '18', label: '活期余额偏低', title: '学习计划', targetCents: 600000, savedCents: 100000, targetDate: '2027-06-30', monthlyCapCents: 180000, incomeCents: 1100000, checkingCents: 120000 },
  { id: '19', label: '首月支出较高', title: '家庭旅行', targetCents: 800000, savedCents: 200000, targetDate: '2027-06-30', monthlyCapCents: 200000, incomeCents: 1100000, currentExpenseCents: 200000 },
  { id: '20', label: '保留健身支出偏好', title: '日本旅行', targetCents: 800000, savedCents: 250000, targetDate: '2027-05-31', monthlyCapCents: 200000, incomeCents: 1100000, preference: '不削减健身支出' },
];

const yuan = (cents: number) => `¥${(cents / 100).toLocaleString('zh-CN')}`;

function inputFor(scenario: Scenario): ExplanationInput {
  const state = createFixture();
  state.finance.monthlyIncomeCents = scenario.incomeCents;
  state.finance.fixedBillsCents = scenario.fixedBillsCents ?? state.finance.fixedBillsCents;
  state.finance.essentialSpendingCents = scenario.essentialSpendingCents ?? state.finance.essentialSpendingCents;
  state.finance.checkingCents = scenario.checkingCents ?? state.finance.checkingCents;
  state.finance.currentMonthExpenseCents = scenario.currentExpenseCents ?? 0;
  state.finance.historyMonths = scenario.historyMonths ?? 3;
  const maxMonthly = Math.min(scenario.monthlyCapCents, availableMonthly(state));
  const protectedCents = scenario.protectedCents ?? state.finance.emergencyCents;
  const firstCapacity = Math.max(0, Math.min(availableMonthly(state) - state.finance.currentMonthExpenseCents,
    state.finance.checkingCents - Math.max(0, protectedCents - state.finance.emergencyCents)));
  const possible: Array<{ monthly: number; projectedDate: string | null; buffer: number; status: 'on_track' | 'at_risk' }> = [];
  const amounts = [...new Set([...Array.from({ length: Math.floor(maxMonthly / 10000) }, (_, index) => (index + 1) * 10000), maxMonthly])];
  for (const monthly of amounts) {
    if (monthly <= 0) continue;
    const candidate: CandidateInput = { targetCents: scenario.targetCents, targetDate: scenario.targetDate,
      monthlyContributionCents: monthly, protectedCents, scenario: { kind: 'baseline' }, evidenceResultIds: [] };
    const assessment = assessCandidateScenario(state, candidate, scenario.savedCents, [], scenario.targetDate);
    if (assessment.status === 'on_track' || assessment.status === 'at_risk') possible.push({ monthly,
      projectedDate: assessment.projectedDate, buffer: assessment.bufferCents, status: assessment.status });
  }
  const chosen = possible.length ? [possible[0], possible[Math.floor((possible.length - 1) / 2)], possible.at(-1)!]
    .filter((item, index, items) => items.findIndex(other => other.monthly === item.monthly) === index) : [];
  return { goal: { title: scenario.title, targetAmountText: yuan(scenario.targetCents),
      savedAmountText: yuan(scenario.savedCents), targetDate: scenario.targetDate },
    constraints: { monthlyCapText: yuan(scenario.monthlyCapCents), protectedAmountText: yuan(protectedCents),
      latestAllowedDate: null, preference: scenario.preference ?? null },
    financialOverview: { monthlyIncomeText: yuan(state.finance.monthlyIncomeCents),
      fixedBillsText: yuan(state.finance.fixedBillsCents), essentialSpendingText: yuan(state.finance.essentialSpendingCents),
      availableMonthlyText: yuan(availableMonthly(state)), firstMonthCapacityText: yuan(firstCapacity),
      source: '当前模拟财务数据' },
    candidates: chosen.map((item, index) => ({ resultId: `${scenario.id}-candidate-${index + 1}`,
      monthlyText: yuan(item.monthly), projectedDate: item.projectedDate,
      firstMonthBufferText: yuan(item.buffer), status: item.status })),
    dataGaps: state.finance.historyMonths < 2 ? ['模拟历史不足 2 个月，不能核验完成日期']
      : possible.length ? [] : ['当前硬限制内没有通过核验的候选'] };
}

type CaseResult = { id: string; label: string; input: ExplanationInput; status: 'ok' | 'failed';
  reason?: string; issues?: string[]; attempts?: number; output?: Awaited<ReturnType<typeof explainAgentCandidates>> extends infer R
    ? R extends { ok: true; explanation: infer E } ? E : never : never; durationMs: number };

const results: CaseResult[] = [];
const jsonPath = resolve('docs/AGENT_EXPLANATION_20_CASES.json');
const markdownPath = resolve('docs/AGENT_EXPLANATION_20_CASES.md');
const previous: CaseResult[] = process.argv.includes('--retry-failed')
  ? (JSON.parse(readFileSync(jsonPath, 'utf8')) as { cases: CaseResult[] }).cases : [];
for (const scenario of scenarios) {
  const saved = previous.find(item => item.id === scenario.id && item.status === 'ok' && item.output &&
    explanationGroundingIssues(item.output, item.input).length === 0);
  if (saved) { results.push({ ...saved, label: scenario.label }); console.log(`${scenario.id}/20 ${scenario.label}: kept ok`); continue; }
  const input = inputFor(scenario);
  const started = Date.now();
  let response = await explainAgentCandidates(input, 35_000);
  let attempts = 1;
  while (!response.ok && attempts < 3) {
    attempts++;
    response = await explainAgentCandidates(input, 35_000);
  }
  const result: CaseResult = response.ok
    ? { id: scenario.id, label: scenario.label, input, status: 'ok', output: response.explanation,
      attempts, durationMs: Date.now() - started }
    : { id: scenario.id, label: scenario.label, input, status: 'failed', reason: response.reason,
      issues: response.issues, attempts, durationMs: Date.now() - started };
  results.push(result);
  console.log(`${scenario.id}/20 ${scenario.label}: ${result.status}${result.reason ? ` (${result.reason})` : ''} attempts=${attempts}`);
}

writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  cases: results }, null, 2), 'utf8');
const summary = `# NOVA 解释提示词：20 个模拟案例的真实 DeepSeek 输出\n\n` +
  `生成日期：${new Date().toISOString()}。输入全部为隔离的模拟数据；金额和候选由服务端算法核算。` +
  `本报告测试解释步骤，不代表完整 Agent 调查链路的通过率。\n\n` +
  `通过 ${results.filter(item => item.status === 'ok').length}/20；失败案例保留错误类别，不展示密钥或原始 API 响应。\n\n`;
const sections = results.map(item => `## ${item.id} · ${item.label}\n\n` +
  `候选数：${item.input.candidates.length}；目标：${item.input.goal.title} ${item.input.goal.targetAmountText}，` +
  `已存 ${item.input.goal.savedAmountText}，目标日 ${item.input.goal.targetDate}。\n\n` +
  `结果：${item.status}${item.reason ? `（${item.reason}）` : ''}；尝试 ${item.attempts ?? 1} 次；耗时 ${item.durationMs} ms。\n\n` +
  '### 输入\n\n```json\n' + JSON.stringify(item.input, null, 2) + '\n```\n\n' +
  '### 输出\n\n```json\n' + JSON.stringify(item.output ?? { error: item.reason, issues: item.issues }, null, 2) + '\n```\n').join('\n');
writeFileSync(markdownPath, summary + sections, 'utf8');
console.log(`完成：${results.filter(item => item.status === 'ok').length}/20；报告 ${markdownPath}`);
