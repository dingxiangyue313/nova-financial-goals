import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This evaluator is deliberately separate from offline CI and never prints prompts or credentials.
const explicitlyEnabled = process.env.NOVA_RUN_REAL_MODEL_EVAL === '1' || process.argv.includes('--real');
if (process.argv.includes('--diagnostics')) process.env.NOVA_EVAL_MODEL_DIAGNOSTICS = '1';
if (!explicitlyEnabled || !process.env.DEEPSEEK_API_KEY) {
  console.log(JSON.stringify({ layer: 'real_model_multi_turn', status: 'skipped',
    reason: !explicitlyEnabled ? 'opt_in_required' : 'key_not_configured' }));
  process.exit(0);
}

const maxCalls = Number(process.argv.find(item => item.startsWith('--max-calls='))?.split('=')[1]
  ?? process.env.NOVA_EVAL_MAX_CALLS ?? 24);
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 24)
  throw new Error('NOVA_EVAL_MAX_CALLS must be an integer from 1 to 24');
const temporary = mkdtempSync(join(tmpdir(), 'nova-agent-real-eval-'));
process.env.NOVA_DB_PATH = join(temporary, 'eval.sqlite');
let modelCalls = 0;
let closeEvalStore: (() => void) | null = null;

try {
  const store = await import('../server/store.ts');
  closeEvalStore = store.closeStore;
  const { createFixture } = await import('../server/fixtures.ts');
  const { runAgentTask, modelDecision } = await import('../server/agent-runner.ts');
  const scenarios = [
    { id: 'original_feasible', savedCents: 350000, targetCents: 800000,
      targetDate: '2026-12-15', capCents: 150000, incomeCents: 900000, historyMonths: 3 },
    { id: 'adjusted_feasible', savedCents: 0, targetCents: 800000,
      targetDate: '2026-12-31', capCents: 200000, incomeCents: 900000, historyMonths: 3 },
    { id: 'limited_no_solution', savedCents: 0, targetCents: 800000,
      targetDate: '2026-10-15', capCents: 50000, incomeCents: 750000, historyMonths: 3 },
    { id: 'insufficient_data', savedCents: 0, targetCents: 800000,
      targetDate: '2026-12-31', capCents: 200000, incomeCents: 900000, historyMonths: 0 },
  ] as const;
  const results = [];
  for (const scenario of scenarios) {
    const onlyScenario = process.argv.find(item => item.startsWith('--scenario='))?.split('=')[1];
    if (onlyScenario && scenario.id !== onlyScenario) continue;
    if (modelCalls >= maxCalls) {
      results.push({ scenario: scenario.id, status: 'skipped_call_cap' });
      continue;
    }
    const sessionId = randomUUID();
    const state = createFixture();
    state.finance.monthlyIncomeCents = scenario.incomeCents;
    state.finance.historyMonths = scenario.historyMonths;
    state.finance.updatedAt = state.clock;
    store.mutateState(sessionId, () => state);
    const threadId = store.createAgentThread(sessionId, { title: '隔离模型评测' }).id;
    // Multiple turns are kept as conversation, while the same server draft owns authoritative numbers.
    store.saveAgentMessage(sessionId, threadId, { role: 'user',
      content: '我想去日本旅行，但先看看当前现金流能不能支持。', components: [] });
    store.saveAgentMessage(sessionId, threadId, { role: 'user',
      content: `目标金额 ${scenario.targetCents / 100} 元，日期 ${scenario.targetDate}，已存 ${scenario.savedCents / 100} 元，每月最多 ${scenario.capCents / 100} 元。应急金不能动。`, components: [] });
    const trigger = store.getAgentMessages(sessionId, threadId).at(-1)!;
    store.saveGoalDraft(sessionId, { id: randomUUID(), threadId, goalId: null,
      title: '日本旅行', targetCents: scenario.targetCents, targetDate: scenario.targetDate,
      savedCents: scenario.savedCents, monthlyContributionCapCents: scenario.capCents,
      protectedCents: 2000000, flexibilityWeeks: null,
      fieldSources: { title: 'user_provided', targetCents: 'user_provided', targetDate: 'user_provided',
        savedCents: 'user_provided', monthlyContributionCents: 'user_provided', protectedCents: 'user_provided' },
      missingRequiredFields: [], updatedAt: new Date().toISOString() });
    const before = store.getState(sessionId);
    const actionCount = store.agentActionCount(sessionId);
    const run = store.createAgentRun(sessionId, threadId, trigger.id);
    const started = Date.now();
    const outcome = await runAgentTask(sessionId, threadId, run.runId, async context => {
      if (modelCalls >= maxCalls) return { failure: 'DEEPSEEK_INVALID_OR_TIMEOUT' };
      modelCalls += 1;
      return modelDecision(context);
    });
    const current = store.getState(sessionId);
    if (current.twinVersion !== before.twinVersion ||
      current.finance.checkingCents !== before.finance.checkingCents ||
      store.agentActionCount(sessionId) !== actionCount)
      throw new Error(`READ_ONLY_INVARIANT_VIOLATED:${scenario.id}`);
    const task = store.getAgentTaskForThread(sessionId, threadId)!;
    const verified = outcome.recommendedResultIds.every(id => {
      if (!task.candidateRefs.includes(id)) return false;
      const result = store.getAgentToolResult(sessionId, threadId, id);
      return result.tool === 'candidate_preview' && result.status === 'ok' &&
        result.twinVersion === current.twinVersion && result.output.assessment?.dataSufficient;
    });
    if (!verified || (scenario.id === 'insufficient_data' && outcome.recommendedResultIds.length))
      throw new Error(`EVIDENCE_INVARIANT_VIOLATED:${scenario.id}`);
    results.push({ scenario: scenario.id, status: outcome.status,
      taskCompleted: outcome.status === 'completed' && outcome.recommendedResultIds.length > 0,
      constraintViolations: outcome.steps.filter(step => step.summary.includes('constraint_violation')).length,
      numericEvidenceCoverage: outcome.recommendedResultIds.length ? 1 : 0,
      unnecessaryQuestions: outcome.status === 'awaiting_user' ? 1 : 0,
      duplicateCandidates: outcome.recommendedResultIds.length - new Set(outcome.recommendedResultIds).size,
      searchCalls: outcome.steps.filter(step => step.summary.startsWith('search_goal_options：')).length,
      toolFailures: outcome.steps.filter(step => step.kind === 'tool_failed').map(step => step.summary),
      modelCalls: outcome.decisionCount, toolCalls: outcome.toolCallCount,
      durationMs: Date.now() - started, fallback: outcome.status === 'fallback',
      reasonCode: outcome.reasonCode });
  }
  console.log(JSON.stringify({ layer: 'real_model_multi_turn', status: 'completed',
    isolatedSimulatedData: true, maxCalls, modelCalls, scenarios: results }, null, 2));
} finally {
  closeEvalStore?.();
  rmSync(temporary, { recursive: true, force: true });
}
