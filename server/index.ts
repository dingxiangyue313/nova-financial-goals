import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { artifactCounts, createAgentThread, deleteAgentThread, getAgentMessages, getState, listAgentThreads,
  markAgentThreadRead, mutateState, renameAgentThread, resetState, setAgentThreadStatus } from './store.ts';
import { snapshot } from './presentation.ts';
import { assessGoal, injectExpense, resolveImpact } from './domain.ts';
import { composeUiCards, interpretGoal } from './agent.ts';
import { verifyOperation } from './tools.ts';
import { registerMcp } from './mcp.ts';
import { IsoDateSchema, RiskPreferencesSchema, type DemoState } from '../shared/contracts.ts';
import { bankingToolDefinitions, runBankingTool, type BankingToolName } from './banking.ts';
import { appendAuditEvent, financialTwin, verifyAuditChain } from './governance.ts';
import { containsPromptInjection, LocalRateLimiter, signExternalRequest, verifyExternalRequest } from './security.ts';
import { createAgentTurn, ensureImpactThread, executeWorkspaceAction } from './workspace.ts';
import { applySpendingTrendDemo, evaluateOneOffExpenseRisk, markActiveRiskSignal } from './risk.ts';

const app = express();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.NOVA_SESSION_SECRET || randomUUID();
const externalAgentSecret = process.env.NOVA_EXTERNAL_AGENT_SECRET || sessionSecret;
if (production && (!process.env.NOVA_SESSION_SECRET || process.env.NOVA_SESSION_SECRET.length < 32))
  throw new Error('NOVA_SESSION_SECRET must contain at least 32 characters in production');

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
const generalLimiter = new LocalRateLimiter(180, 60_000);
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  try { if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'INVALID_ORIGIN' }); }
  catch { return res.status(403).json({ error: 'INVALID_ORIGIN' }); }
  const sessionHint = (req.headers.cookie || '').match(/nova_demo_sid=([0-9a-f-]{36})/)?.[1] || 'anonymous';
  const key = `${req.ip || req.socket.remoteAddress || 'local'}:${sessionHint}:${req.path.startsWith('/agent') ? 'agent' : 'api'}`;
  if (!generalLimiter.take(key)) return res.status(429).json({ error: 'RATE_LIMITED' });
  const startedAt = Date.now();
  res.on('finish', () => console.info(JSON.stringify({ event: 'http_request', method: req.method,
    path: req.path, status: res.statusCode, durationMs: Date.now() - startedAt })));
  next();
});

function sign(value: string) { return createHmac('sha256', sessionSecret).update(value).digest('hex'); }
function mcpToken(id: string) { return `${id}.${sign(`mcp:${id}`)}`; }
function verifyMcpToken(token: string) {
  const [id, mac] = token.split('.');
  if (!id || !mac || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = sign(`mcp:${id}`);
  return mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected)) ? id : null;
}
function sessionId(req: express.Request, res: express.Response): string {
  const raw = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('nova_demo_sid='))?.slice('nova_demo_sid='.length);
  if (raw) {
    const [id, mac] = raw.split('.');
    const expected = id && sign(id);
    if (id && mac && expected && mac.length === expected.length && timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return id;
  }
  const id = randomUUID();
  res.setHeader('Set-Cookie', `nova_demo_sid=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${production ? '; Secure' : ''}`);
  return id;
}
function respond(res: express.Response, state: DemoState) { return res.json(snapshot(state)); }
function failure(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  const bad = error instanceof z.ZodError || /^(PLAN_|NO_PENDING|INVALID_|CONFIRMATION_|GOAL_|OPERATION_|INSUFFICIENT_|MANDATE_|IDEMPOTENCY_|APPROVAL_|TWIN_|EXTERNAL_|NONCE_|STALE_|RATE_|PROTECTED_|FX_|ACCOUNT_|CURRENCY_|UNKNOWN_TOOL|SUBJECT_|THREAD_|AGENT_)/.test(message);
  return res.status(bad ? 400 : 500).json({ error: bad ? message : '服务暂时不可用，请稍后重试。' });
}
function route(fn: (req: express.Request, res: express.Response) => Promise<unknown> | unknown): express.RequestHandler {
  return (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(error => failure(res, error)); };
}
const audit = (state: DemoState, action: string, outcome: string, detail: string): DemoState => {
  const next = { ...state, twinVersion: state.twinVersion + 1,
    accounts: state.accounts.map(item => item.id === 'checking' ? { ...item, balanceCents: state.finance.checkingCents }
      : item.id === 'emergency' ? { ...item, balanceCents: state.finance.emergencyCents }
      : item.id === 'goal-wallet' ? { ...item, balanceCents: state.goal.savedCents } : item) };
  return appendAuditEvent(next, action, outcome, detail);
};

app.get('/api/health', route((req, res) => {
  const id = sessionId(req, res);
  res.json({ status: 'ok', mode: 'simulated', sqlite: 'ok', contracts: 'ok',
    deepseek: process.env.DEEPSEEK_API_KEY ? 'configured' : 'deterministic_fallback',
    auditChainValid: verifyAuditChain(getState(id).audit), artifacts: artifactCounts(id) });
}));
app.get('/api/session', route((req, res) => respond(res, getState(sessionId(req, res)))));
const toolNames = new Set<string>(bankingToolDefinitions.map(item => item.name));
const BankingCallSchema = z.object({ tool: z.string().refine(value => toolNames.has(value), 'UNKNOWN_TOOL'),
  input: z.record(z.string(), z.unknown()).default({}), userConfirmed: z.boolean().default(false),
  expectedTwinVersion: z.number().int().positive().optional() });
function executeTool(session: string, call: z.infer<typeof BankingCallSchema>) {
  let result: unknown;
  const state = mutateState(session, old => {
    if (call.expectedTwinVersion !== undefined && old.twinVersion !== call.expectedTwinVersion) throw new Error('TWIN_VERSION_CHANGED');
    const outcome = runBankingTool(old, call.tool as BankingToolName, call.input, { userConfirmed: call.userConfirmed });
    result = outcome.result;
    return outcome.state;
  });
  return { result, twinVersion: state.twinVersion };
}
function assertExpectedTwin(state: DemoState, value: unknown) {
  if (value !== undefined && z.number().int().positive().parse(value) !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
}
app.get('/api/financial-twin', route((req, res) => res.json(financialTwin(getState(sessionId(req, res))))));
app.post('/api/financial-twin', route((req, res) => res.json(executeTool(sessionId(req, res), BankingCallSchema.parse(req.body)))));
app.get('/api/goal-flow', route((req, res) => {
  const state = getState(sessionId(req, res));
  res.json({ goal: state.goal, assessment: assessGoal(state), twinVersion: state.twinVersion });
}));
app.post('/api/goal-flow', route((req, res) => res.json(executeTool(sessionId(req, res), BankingCallSchema.parse(req.body)))));
app.get('/api/banking-tools', (_req, res) => res.json({ tools: bankingToolDefinitions }));
app.post('/api/banking-tools', route((req, res) => res.json(executeTool(sessionId(req, res), BankingCallSchema.parse(req.body)))));
app.get('/api/activity', route((req, res) => {
  const state = getState(sessionId(req, res));
  res.json({ events: state.audit.slice().reverse(), chainValid: verifyAuditChain(state.audit) });
}));
app.get('/api/risk/preferences', route((req, res) => {
  const state = getState(sessionId(req, res));
  res.json({ preferences: state.riskPreferences, twinVersion: state.twinVersion });
}));
app.patch('/api/risk/preferences', route((req, res) => {
  const changes = RiskPreferencesSchema.partial().parse(req.body);
  const state = mutateState(sessionId(req, res), old => appendAuditEvent({
    ...old,
    riskPreferences: RiskPreferencesSchema.parse({ ...old.riskPreferences, ...changes }),
    twinVersion: old.twinVersion + 1,
  }, 'risk_preferences', 'updated', '用户更新智能守护设置'));
  res.json({ preferences: state.riskPreferences, twinVersion: state.twinVersion });
}));
app.get('/api/risk/signals', route((req, res) => {
  const state = getState(sessionId(req, res));
  res.json({ signals: state.riskSignals, patterns: state.spendingPatterns, twinVersion: state.twinVersion });
}));
app.get('/api/audit/export', route((req, res) => {
  const format = z.enum(['json', 'csv']).catch('json').parse(req.query.format);
  const outcome = runBankingTool(getState(sessionId(req, res)), 'export_audit_report', { format });
  res.type(format === 'csv' ? 'text/csv' : 'application/json').send(outcome.result.content);
}));
app.post('/api/agent', route(async (req, res) => {
  const message = z.string().min(1).max(500).parse(req.body?.message);
  const state = getState(sessionId(req, res));
  if (containsPromptInjection(message)) return res.json({ intent: 'rejected_prompt_injection', plan: [],
    provider: 'deterministic', fallbackReason: 'PROMPT_INJECTION_DETECTED', toolResults: [] });
  const parsed = await interpretGoal(message, state.clock);
  res.json({ intent: 'create_or_update_goal', plan: ['解析目标', '用户核对', '比较方案', '明确确认'],
    provider: parsed.provider, fallbackReason: parsed.notice || null,
    toolResults: [{ tool: 'interpret_goal', result: parsed.goal }] });
}));
app.get('/api/agent/threads', route((req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  res.json({ threads: listAgentThreads(sessionId(req, res), includeArchived) });
}));
app.post('/api/agent/threads', route((req, res) => {
  const title = z.string().min(1).max(80).default('新的目标任务').parse(req.body?.title);
  res.json({ thread: createAgentThread(sessionId(req, res), { title }) });
}));
app.patch('/api/agent/threads/:id', route((req, res) => {
  const body = z.object({ title: z.string().min(1).max(80).optional(),
    status: z.enum(['active', 'archived']).optional() }).refine(value => value.title || value.status).parse(req.body);
  const id = sessionId(req, res);
  let thread = body.title ? renameAgentThread(id, req.params.id, body.title) : undefined;
  if (body.status) thread = setAgentThreadStatus(id, req.params.id, body.status);
  res.json({ thread });
}));
app.delete('/api/agent/threads/:id', route((req, res) => {
  deleteAgentThread(sessionId(req, res), req.params.id); res.json({ deleted: true });
}));
app.get('/api/agent/threads/:id/messages', route((req, res) => {
  const id = sessionId(req, res); const messages = getAgentMessages(id, req.params.id);
  markAgentThreadRead(id, req.params.id); res.json({ messages });
}));
app.post('/api/agent/turn', route(async (req, res) => {
  const body = z.object({ threadId: z.string().nullable().default(null), message: z.string().min(1).max(500) }).parse(req.body);
  const id = sessionId(req, res);
  res.json(await createAgentTurn(id, body.threadId, body.message, getState(id)));
}));
app.post('/api/agent/action', route((req, res) => {
  const body = z.object({ actionId: z.string(), decision: z.enum(['confirm', 'cancel']) }).parse(req.body);
  const id = sessionId(req, res); let outcome: ReturnType<typeof executeWorkspaceAction> | undefined;
  const state = mutateState(id, old => { outcome = executeWorkspaceAction(id, body.actionId, body.decision, old); return outcome.state; });
  res.json({ snapshot: snapshot(state), message: outcome!.message, replayed: outcome!.replayed });
}));
app.get('/api/ui/cards', route(async (req, res) => {
  const cards = snapshot(getState(sessionId(req, res))).cards;
  res.json(await composeUiCards(cards));
}));
app.get('/api/mcp/token', route((req, res) => res.json({ token: mcpToken(sessionId(req, res)), endpoint: '/mcp' })));
app.post('/api/demo/reset', route((req, res) => respond(res, resetState(sessionId(req, res)))));
app.post('/api/demo/scenario', route((req, res) => {
  const scenario = z.enum(['insufficient_data', 'infeasible', 'normal']).parse(req.body?.scenario);
  const state = mutateState(sessionId(req, res), old => {
    const finance = { ...old.finance,
      historyMonths: scenario === 'insufficient_data' ? 1 : 3,
      monthlyIncomeCents: scenario === 'infeasible' ? 600000 : 900000 };
    return audit({ ...old, finance }, 'demo_scenario', scenario, `切换为 ${scenario} 演示状态`);
  });
  return respond(res, state);
}));
app.post('/api/demo/spending-trend', route((req, res) => {
  z.object({ idempotencyKey: z.string().min(1).max(100).default('delivery-rides-september') }).parse(req.body || {});
  const id = sessionId(req, res);
  const state = mutateState(id, old => {
    const outcome = applySpendingTrendDemo(old);
    if (outcome.replayed) return old;
    return appendAuditEvent(outcome.state, 'spending_trend', outcome.decision?.outcome || 'silent',
      '外卖与打车累计趋势已由目标感知风险引擎评估');
  });
  ensureImpactThread(id, state);
  return respond(res, state);
}));
app.post('/api/demo/clock', route((req, res) => {
  const date = z.iso.date().parse(req.body?.date);
  const state = mutateState(sessionId(req, res), old => audit({ ...old, clock: date }, 'demo_clock', 'changed', `演示日期设为 ${date}`));
  return respond(res, state);
}));
app.post('/api/goal/interpret', route(async (req, res) => {
  const text = z.string().min(1).max(500).parse(req.body?.text);
  const state = getState(sessionId(req, res));
  res.json(await interpretGoal(text, state.clock));
}));
app.post('/api/goals', route((req, res) => {
  const body = z.object({ title: z.string().min(1).max(60), targetCents: z.number().int().positive(),
    targetDate: IsoDateSchema, protectedCents: z.number().int().nonnegative(),
    quote: z.string().max(500).default(''), flexibilityWeeks: z.number().int().min(0).max(52).default(2) }).parse(req.body);
  const state = mutateState(sessionId(req, res), old => { assertExpectedTwin(old, req.body?.expectedTwinVersion); return runBankingTool(old, 'create_goal', body).state; });
  return respond(res, state);
}));
app.patch('/api/goals/current', route((req, res) => {
  const changes = z.object({ title: z.string().min(1).max(60).optional(), targetCents: z.number().int().positive().optional(),
    targetDate: IsoDateSchema.optional(), protectedCents: z.number().int().nonnegative().optional(),
    savedCents: z.number().int().nonnegative().optional(), quote: z.string().max(500).optional(),
    flexibilityWeeks: z.number().int().min(0).max(52).optional() }).parse(req.body);
  const state = mutateState(sessionId(req, res), old => { assertExpectedTwin(old, req.body?.expectedTwinVersion); return runBankingTool(old, 'update_goal', changes).state; });
  return respond(res, state);
}));
app.post('/api/goals/activate', route((req, res) => {
  const planId = z.string().nullable().parse(req.body?.planId ?? null);
  if (!planId) throw new Error('PLAN_NOT_SELECTED');
  const state = mutateState(sessionId(req, res), old => {
    assertExpectedTwin(old, req.body?.expectedTwinVersion);
    const selected = runBankingTool(old, 'select_goal_plan', { planId });
    const approval = runBankingTool(selected.state, 'create_approval_snapshot', {
      action: 'activate_goal', parameters: { planId }, expiresInSeconds: 300,
    });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', {
      approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
    }, { userConfirmed: true });
    return runBankingTool(confirmed.state, 'activate_goal', { planId, approvalToken: confirmed.result.approvalToken }).state;
  });
  return respond(res, state);
}));
app.post('/api/demo/expense', route((req, res) => {
  const body = z.object({ amountCents: z.number().int().positive(), title: z.string().min(1).max(60) }).parse(req.body);
  const id = sessionId(req, res);
  const state = mutateState(id, old => {
    const result = injectExpense(old, body.amountCents, body.title);
    const decision = evaluateOneOffExpenseRisk(old, body.amountCents);
    const acceptedImpact = decision.outcome === 'immediate_signal' ? result.impact : null;
    const withTransaction = { ...result.state, pendingImpact: acceptedImpact,
      transactions: [{ id: randomUUID(), accountId: 'checking',
      date: old.clock, title: body.title, category: 'expense', amountCents: -body.amountCents }, ...result.state.transactions] };
    return audit(withTransaction, 'simulate_expense', decision.outcome, body.title);
  });
  ensureImpactThread(id, state);
  return respond(res, state);
}));
app.post('/api/demo/deposit', route((req, res) => {
  const amountCents = z.number().int().positive().parse(req.body?.amountCents);
  const state = mutateState(sessionId(req, res), old => {
    if (amountCents > old.finance.checkingCents) throw new Error('INSUFFICIENT_BALANCE');
    return audit({ ...old, goal: { ...old.goal, savedCents: old.goal.savedCents + amountCents },
      finance: { ...old.finance, checkingCents: old.finance.checkingCents - amountCents },
      transactions: [{ id: randomUUID(), accountId: 'checking', date: old.clock, title: '存入目标钱包',
        category: 'goal_transfer', amountCents: -amountCents }, ...old.transactions] }, 'simulate_deposit', 'executed', '模拟目标存入');
  });
  return respond(res, state);
}));
app.post('/api/impact/decision', route((req, res) => {
  const decision = z.enum(['A','B','later','dismiss']).parse(req.body?.decision);
  const state = mutateState(sessionId(req, res), old => {
    const impactId = old.pendingImpact?.id;
    return audit(markActiveRiskSignal(resolveImpact(old, decision), decision, impactId),
      'impact_decision', decision, `用户选择 ${decision}`);
  });
  return respond(res, state);
}));
app.post('/api/mandates', route((req, res) => {
  const body = z.object({ confirmed: z.literal(true), category: z.enum(['transport','shopping']).optional(),
    maxPerOperationCents: z.number().int().positive().optional(), totalLimitCents: z.number().int().positive().optional(),
    expiresAt: IsoDateSchema.optional() }).parse(req.body);
  return respond(res, mutateState(sessionId(req, res), old => {
    if (old.goal.status !== 'active') throw new Error('GOAL_NOT_ACTIVE');
    const parameters = { agentId: 'travel-agent-demo', category: body.category || 'transport',
      maxPerOperationCents: body.maxPerOperationCents ?? 50000, totalLimitCents: body.totalLimitCents ?? 120000,
      expiresAt: body.expiresAt || '2026-12-31' };
    const approval = runBankingTool(old, 'create_approval_snapshot', { action: 'create_mandate', parameters, expiresInSeconds: 300 });
    const confirmed = runBankingTool(approval.state, 'confirm_approval', {
      approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
    }, { userConfirmed: true });
    return runBankingTool(confirmed.state, 'create_mandate', { ...parameters, approvalToken: confirmed.result.approvalToken }).state;
  }));
}));
app.post('/api/mandates/revoke', route((req, res) => respond(res, mutateState(sessionId(req, res), old => {
  if (!old.mandate) throw new Error('MANDATE_NOT_FOUND');
  const parameters = { mandateId: old.mandate.id };
  const approval = runBankingTool(old, 'create_approval_snapshot', { action: 'revoke_mandate', parameters, expiresInSeconds: 300 });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  return runBankingTool(confirmed.state, 'revoke_mandate', { ...parameters, approvalToken: confirmed.result.approvalToken }).state;
}))));
app.post('/api/demo/agent-request', route((req, res) => {
  const body = z.object({ scenario: z.enum(['transport','shopping','manual_review','over_limit','invalid_identity','timeout']),
    idempotencyKey: z.string().max(100).optional() }).parse(req.body);
  const request = { agentId: body.scenario === 'invalid_identity' ? 'unknown-agent' : 'travel-agent-demo',
    category: 'shopping', amountCents: 20000, idempotencyKey: body.idempotencyKey || randomUUID(),
    simulateTimeout: body.scenario === 'timeout' };
  if (body.scenario !== 'shopping') { request.category = 'transport'; request.amountCents = body.scenario === 'over_limit' ? 200000 : body.scenario === 'manual_review' ? 40000 : 30000; }
  const id = sessionId(req, res);
  const envelope = { agentId: request.agentId, subject: id, timestamp: Date.now(), nonce: randomUUID(), body: request };
  const signature = signExternalRequest(externalAgentSecret, envelope);
  const state = mutateState(id, old => {
    const verified = verifyExternalRequest(old, externalAgentSecret, envelope, signature, Date.now(), id);
    return runBankingTool(verified.state, 'evaluate_external_request', request).state;
  });
  return respond(res, state);
}));
app.post('/api/external-agent/request', route((req, res) => {
  const id = sessionId(req, res);
  const envelope = z.object({ agentId: z.string().min(1), subject: z.string().min(1), timestamp: z.number().int(),
    nonce: z.string().min(8).max(100), body: z.object({ category: z.string(), amountCents: z.number().int().positive(),
      idempotencyKey: z.string().min(1).max(100), simulateTimeout: z.boolean().default(false) }) }).parse(req.body);
  const signature = z.string().parse(req.get('x-nova-signature'));
  let result: unknown;
  mutateState(id, old => {
    const verified = verifyExternalRequest(old, externalAgentSecret, envelope, signature, Date.now(), id);
    const outcome = runBankingTool(verified.state, 'evaluate_external_request', { ...envelope.body, agentId: envelope.agentId });
    result = outcome.result;
    return outcome.state;
  });
  res.json(result);
}));
app.post('/api/operations/:id/approve', route((req, res) => respond(res, mutateState(sessionId(req, res), old => {
  const parameters = { operationId: req.params.id };
  const approval = runBankingTool(old, 'create_approval_snapshot', { action: 'approve_external_operation', parameters, expiresInSeconds: 300 });
  const confirmed = runBankingTool(approval.state, 'confirm_approval', {
    approvalId: approval.result.approvalId, snapshotHash: approval.result.snapshotHash, confirmed: true,
  }, { userConfirmed: true });
  return runBankingTool(confirmed.state, 'approve_external_operation', { ...parameters, approvalToken: confirmed.result.approvalToken }).state;
}))));
app.post('/api/operations/:id/reconcile', route((req, res) => respond(res, mutateState(sessionId(req, res), old =>
  runBankingTool(old, 'reconcile_operation', { operationId: req.params.id }).state))));
app.get('/api/operations/:id', route((req, res) => res.json(verifyOperation(getState(sessionId(req, res)), req.params.id))));
registerMcp(app, verifyMcpToken);

if (production) {
  app.use(express.static(path.join(rootDir, 'dist')));
  app.get(/.*/, (_req, res) => res.sendFile(path.join(rootDir, 'dist', 'index.html')));
} else {
  const vite = await createViteServer({ root: rootDir, server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
}
app.listen(port, '0.0.0.0', () => console.log(`NOVA original UI + new simulated backend: http://localhost:${port}`));
