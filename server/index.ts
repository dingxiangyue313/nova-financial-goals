import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { z } from 'zod';
import { getState, mutateState, resetState } from './store.ts';
import { snapshot } from './presentation.ts';
import { activatePlan, injectExpense, resolveImpact } from './domain.ts';
import { composeUiCards, interpretGoal } from './agent.ts';
import { approveOperation, createMandate, evaluateExternalRequest, reconcileOperation, revokeMandate, verifyOperation } from './tools.ts';
import { registerMcp } from './mcp.ts';
import { IsoDateSchema, type DemoState } from '../shared/contracts.ts';

const app = express();
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.NOVA_SESSION_SECRET || randomUUID();
if (production && (!process.env.NOVA_SESSION_SECRET || process.env.NOVA_SESSION_SECRET.length < 32))
  throw new Error('NOVA_SESSION_SECRET must contain at least 32 characters in production');

app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  try { if (origin && new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'INVALID_ORIGIN' }); }
  catch { return res.status(403).json({ error: 'INVALID_ORIGIN' }); }
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
  const bad = error instanceof z.ZodError || /^(PLAN_|NO_PENDING|INVALID_|CONFIRMATION_|GOAL_|OPERATION_|INSUFFICIENT_|MANDATE_|IDEMPOTENCY_)/.test(message);
  return res.status(bad ? 400 : 500).json({ error: bad ? message : '服务暂时不可用，请稍后重试。' });
}
function route(fn: (req: express.Request, res: express.Response) => Promise<unknown> | unknown): express.RequestHandler {
  return (req, res) => { Promise.resolve().then(() => fn(req, res)).catch(error => failure(res, error)); };
}
const audit = (state: DemoState, action: string, outcome: string, detail: string): DemoState => ({ ...state, audit: [...state.audit,
  { id: randomUUID(), at: `${state.clock}T12:00:00Z`, action, outcome, detail }] });

app.get('/api/health', (_req, res) => res.json({ status: 'ok', mode: 'simulated' }));
app.get('/api/session', route((req, res) => respond(res, getState(sessionId(req, res)))));
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
  const state = mutateState(sessionId(req, res), old => audit({ ...old, goal: { ...old.goal,
    id: randomUUID(), title: body.title, targetCents: body.targetCents,
    savedCents: body.title === old.goal.title ? old.goal.savedCents : 0,
    targetDate: body.targetDate, originalDate: body.targetDate, protectedCents: body.protectedCents,
    flexibilityWeeks: body.flexibilityWeeks, quote: body.quote,
    status: 'draft', selectedPlanId: null, monthlyContributionCents: 0 },
    finance: { ...old.finance, emergencyCents: body.protectedCents },
    pendingImpact: null, mandate: null }, 'create_goal', 'draft', body.title));
  return respond(res, state);
}));
app.patch('/api/goals/current', route((req, res) => {
  const changes = z.object({ title: z.string().min(1).max(60).optional(), targetCents: z.number().int().positive().optional(),
    targetDate: IsoDateSchema.optional(), protectedCents: z.number().int().nonnegative().optional(),
    savedCents: z.number().int().nonnegative().optional(), quote: z.string().max(500).optional(),
    flexibilityWeeks: z.number().int().min(0).max(52).optional() }).parse(req.body);
  const state = mutateState(sessionId(req, res), old => audit({ ...old, goal: { ...old.goal, ...changes,
    originalDate: changes.targetDate ?? old.goal.originalDate,
    status: 'draft', selectedPlanId: null },
    finance: changes.protectedCents === undefined ? old.finance : { ...old.finance, emergencyCents: changes.protectedCents },
    pendingImpact: null, mandate: null }, 'update_goal', 'draft', '目标参数已修改，方案需要重新选择'));
  return respond(res, state);
}));
app.post('/api/goals/activate', route((req, res) => {
  const planId = z.string().nullable().parse(req.body?.planId ?? null);
  const state = mutateState(sessionId(req, res), old => audit(activatePlan(old, planId), 'activate_plan', 'confirmed', `用户选择 ${planId}`));
  return respond(res, state);
}));
app.post('/api/demo/expense', route((req, res) => {
  const body = z.object({ amountCents: z.number().int().positive(), title: z.string().min(1).max(60) }).parse(req.body);
  const state = mutateState(sessionId(req, res), old => {
    const result = injectExpense(old, body.amountCents, body.title);
    return audit(result.state, 'simulate_expense', result.impact ? 'impact' : 'no_signal', body.title);
  });
  return respond(res, state);
}));
app.post('/api/demo/deposit', route((req, res) => {
  const amountCents = z.number().int().positive().parse(req.body?.amountCents);
  const state = mutateState(sessionId(req, res), old => {
    if (amountCents > old.finance.checkingCents) throw new Error('INSUFFICIENT_BALANCE');
    return audit({ ...old, goal: { ...old.goal, savedCents: old.goal.savedCents + amountCents },
      finance: { ...old.finance, checkingCents: old.finance.checkingCents - amountCents } }, 'simulate_deposit', 'executed', '模拟目标存入');
  });
  return respond(res, state);
}));
app.post('/api/impact/decision', route((req, res) => {
  const decision = z.enum(['A','B','later','dismiss']).parse(req.body?.decision);
  const state = mutateState(sessionId(req, res), old => audit(resolveImpact(old, decision), 'impact_decision', decision, `用户选择 ${decision}`));
  return respond(res, state);
}));
app.post('/api/mandates', route((req, res) => {
  const body = z.object({ confirmed: z.literal(true), category: z.enum(['transport','shopping']).optional(),
    maxPerOperationCents: z.number().int().positive().optional(), totalLimitCents: z.number().int().positive().optional(),
    expiresAt: IsoDateSchema.optional() }).parse(req.body);
  return respond(res, mutateState(sessionId(req, res), old => createMandate(old, body)));
}));
app.post('/api/mandates/revoke', route((req, res) => respond(res, mutateState(sessionId(req, res), revokeMandate))));
app.post('/api/demo/agent-request', route((req, res) => {
  const body = z.object({ scenario: z.enum(['transport','shopping','over_limit','invalid_identity','timeout']),
    idempotencyKey: z.string().max(100).optional() }).parse(req.body);
  const request = { agentId: body.scenario === 'invalid_identity' ? 'unknown-agent' : 'travel-agent-demo',
    category: 'shopping', amountCents: 20000, idempotencyKey: body.idempotencyKey || randomUUID(),
    simulateTimeout: body.scenario === 'timeout' };
  if (body.scenario !== 'shopping') { request.category = 'transport'; request.amountCents = body.scenario === 'over_limit' ? 200000 : 30000; }
  const state = mutateState(sessionId(req, res), old => evaluateExternalRequest(old, request).state);
  return respond(res, state);
}));
app.post('/api/operations/:id/approve', route((req, res) => respond(res, mutateState(sessionId(req, res), old => approveOperation(old, req.params.id)))));
app.post('/api/operations/:id/reconcile', route((req, res) => respond(res, mutateState(sessionId(req, res), old => reconcileOperation(old, req.params.id)))));
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
