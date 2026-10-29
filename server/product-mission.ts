import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import type { Express, Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { BillPeriodInputSchema, DatedCashflowForecastInputSchema, type DemoState } from '../shared/contracts.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { previewStatementImport, commitStatementImport, statementImportContentHash } from './statement-import.ts';
import type { ParsedStatement } from './statement-parser.ts';
import { buildBillBrief } from './bill-analysis.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { buildMoneyMissionPlans, goalForecastWindow } from './money-mission-plans.ts';
import { createAgentAction, createAgentThread, getAgentAction, getState, mutateState, finishAgentAction } from './store.ts';
import { prepareSubscriptionConfirmation, prepareTransferScheduleConfirmation, executeWorkspaceAction } from './workspace.ts';
import { appendAuditEvent, createApprovalSnapshot, confirmApproval, consumeApproval, stableHash } from './governance.ts';
import { snapshot } from './presentation.ts';
import { resumeTransferSchedule } from './transfer-schedules.ts';
import { prepareAccountSnapshot } from './account-snapshots.ts';
import { syntheticStatements } from './synthetic-statements.ts';
import { saveStatementImportPreview } from './store.ts';
import { initializeServices } from './financial-services.ts';
import {addSubscriptionSamples,subscriptionReminders,subscriptionDisputes} from './subscription-catalog.ts';

const categories: Record<string, string> = { 工资: 'income', 餐饮: 'dining', 住房: 'housing', 交通: 'transport', 购物: 'shopping', 订阅: 'subscriptions', 水电: 'utilities', 保险: 'insurance', 退款: 'refund', 内部转账: 'internal_transfer' };
export async function consumerFixture(history = true) {
  let state = createJapanMoneyMissionFixture();
  state = { ...state, goal: { ...state.goal, imageUrl: '/japan-trip.jpg' }, goals: state.goals.map(goal => ({ ...goal, imageUrl: '/japan-trip.jpg' })) };
  if (!history) return state;
  const records = parse(await readFile(new URL('../public/samples/nova-synthetic-statements.csv', import.meta.url)), { columns: true }) as Array<Record<string, string>>;
  const parsed: ParsedStatement = { templateId: 'bank-csv-v1', format: 'csv', accountId: 'checking', sourceKind: 'bank', confidence: 1, issues: [],
    rows: records.map((row, index) => ({ rowNumber: index + 1, date: row.date, rawDescription: row.merchant, amountCents: Number(row.cents),
      category: categories[row.category] ?? 'unclassified', merchantId: row.merchant === 'CloudBox Plus' ? 'cloudbox' : null,
      confidence: 1, originalValues: { date: row.date, description: row.merchant, amount: String(Number(row.cents) / 100) }, issues: [] })) };
  const preview = previewStatementImport(state, parsed);
  state = commitStatementImport(preview.state, preview.batch.id, preview.state.twinVersion, statementImportContentHash(preview.state, preview.batch.id));
  return state;
}

export function productMission(state: DemoState) {
  const brief = buildBillBrief(state, { periodStart: `${state.clock.slice(0, 7)}-01`, periodEnd: state.clock });
  const forecast = buildDatedCashflowForecast(state, { accountId: 'checking', horizonEnd: goalForecastWindow(state,state.goal.targetDate).horizonEnd, scenario: 'baseline' });
  const plans = buildMoneyMissionPlans(state, forecast);
  const projection = { ...state, billBriefs: [brief], datedCashflowForecasts: [forecast], goalPlanOptions: plans };
  return { snapshot: snapshot(projection), brief, forecast, plans, subscriptions: state.subscriptions,subscriptionReminders:subscriptionReminders(state),subscriptionDisputes:subscriptionDisputes(state),
    migrationNotice:state.legacyProductArtifacts.requiresScheduleReconfirmation===true,
    batches: state.statementImportBatches, issues: state.importIssues,
    rows: state.normalizedStatementRows.map(({ originalValues: _o, correctedValues: _c, ...row }) => row) };
}
export type ProductMission = ReturnType<typeof productMission>;
export async function fundedConsumerFixture(){
  const fixture=await consumerFixture(),goal={...fixture.goal,savedCents:800000,status:'active' as const};
  return {...fixture,goal,goals:[goal],accounts:fixture.accounts.map(a=>a.id==='goal-wallet'?{...a,balanceCents:800000}:a),
    accountSnapshots:fixture.accountSnapshots.map(a=>a.accountId==='goal-wallet'?{...a,balanceCents:800000,sourceId:'funded-trip-synthetic-opening'}:a)};
}

export function registerProductMission(app: Express, sessionId: (req: Request, res: Response) => string,
  route: (fn: (req: Request, res: Response) => unknown) => RequestHandler) {
  app.post('/api/product/subscription-samples',route((req,res)=>{
    const body=z.object({expectedTwinVersion:z.number().int().positive()}).strict().parse(req.body);
    const next=mutateState(sessionId(req,res),state=>{
      if(body.expectedTwinVersion!==state.twinVersion)throw new Error('TWIN_VERSION_CHANGED');
      return addSubscriptionSamples(state);
    });res.json(productMission(next));
  }));
  app.post('/api/product/goals',route((req,res)=>{
    const body=z.object({title:z.string().trim().min(1).max(60),targetCents:z.number().int().positive().max(100000000),targetDate:z.iso.date(),protectedCents:z.number().int().nonnegative().max(100000000),expectedTwinVersion:z.number().int().positive()}).strict().parse(req.body);
    const id=sessionId(req,res),next=mutateState(id,old=>{
      if(old.twinVersion!==body.expectedTwinVersion)throw new Error('TWIN_VERSION_CHANGED');
      if(body.targetDate<=old.clock)throw new Error('GOAL_DATE_MUST_BE_FUTURE');
      const state=initializeServices(old),goal={...state.goal,id:randomUUID(),title:body.title,targetCents:body.targetCents,targetDate:body.targetDate,originalDate:body.targetDate,
        protectedCents:body.protectedCents,savedCents:0,monthlyContributionCents:0,firstMonthContributionCents:0,selectedPlanId:null,status:'draft' as const,quote:`${body.targetDate}前准备${body.targetCents/100}元用于${body.title}`};
      return appendAuditEvent({...state,goal,goals:[...state.goals,goal],primaryGoalId:goal.id,pendingImpact:null,twinVersion:state.twinVersion+1},'consumer_create_goal','draft','已创建目标草稿；原有账户、其他目标资金和授权保持不变。');
    });res.json(productMission(next).snapshot);
  }));
  app.post('/api/demo/services/scenario',route(async(req,res)=>{
    const body=z.object({scenario:z.literal('funded_trip'),expectedTwinVersion:z.number().int().positive().optional()}).strict().parse(req.body);
    const id=sessionId(req,res),fixture=await fundedConsumerFixture();
    const next=mutateState(id,old=>{
      if(body.expectedTwinVersion!==undefined&&body.expectedTwinVersion!==old.twinVersion)throw new Error('TWIN_VERSION_CHANGED');
      return {...fixture,twinVersion:old.twinVersion+1};
    });
    res.json(productMission(next).snapshot);
  }));
  app.post('/api/product/synthetic-preview',route((req,res)=>{
    const {profile}=z.object({profile:z.enum(['travel','flex','longterm'])}).strict().parse(req.body),id=sessionId(req,res);
    const result=previewStatementImport(getState(id),syntheticStatements(profile,getState(id).clock));
    saveStatementImportPreview(id,{batch:result.batch,issues:result.issues,rows:result.state.normalizedStatementRows.filter(row=>row.batchId===result.batch.id)});
    res.json({batch:result.batch,issues:result.issues,contentHash:result.contentHash,twinVersion:result.state.twinVersion});
  }));
  app.post('/api/product/start', route(async (req, res) => {
    const { includeHistory } = z.object({ includeHistory: z.boolean().default(true) }).strict().parse(req.body ?? {});
    const id = sessionId(req, res), before = getState(id);
    if (!before.goals.length) { const fresh = await consumerFixture(includeHistory); mutateState(id, () => fresh); }
    res.json(productMission(getState(id)).snapshot);
  }));
  app.get('/api/product/mission', route((req, res) => res.json(productMission(getState(sessionId(req, res))))));
  app.post('/api/product/bill',route((req,res)=>res.json(buildBillBrief(getState(sessionId(req,res)),BillPeriodInputSchema.parse(req.body)))));
  app.post('/api/product/forecast',route((req,res)=>{
    const input=DatedCashflowForecastInputSchema.parse(req.body),state=getState(sessionId(req,res));
    // This endpoint simulates only. It does not save authority or create an action.
    res.json(buildDatedCashflowForecast(state,input));
  }));
  app.post('/api/product/evidence/:id/category',route((req,res)=>{
    const body=z.object({category:z.enum(['dining','housing','transport','shopping','subscriptions','utilities','insurance','health','education','entertainment','unclassified']),expectedTwinVersion:z.number().int().positive()}).strict().parse(req.body);
    const id=sessionId(req,res);
    const next=mutateState(id,state=>{
      if(state.twinVersion!==body.expectedTwinVersion)throw new Error('TWIN_VERSION_CHANGED');
      const row=state.normalizedStatementRows.find(r=>r.id===req.params.id&&state.statementImportBatches.some(b=>b.id===r.batchId&&b.status==='committed'));
      if(!row||row.excludedReason||row.amountCents>=0)throw new Error('EVIDENCE_CLASSIFICATION_NOT_ALLOWED');
      if(row.category===body.category)return state;
      const previous=row.category;
      const rows=state.normalizedStatementRows.map(r=>r.id!==row.id?r:{...r,category:body.category,originalValues:{...r.originalValues,category:r.originalValues.category??previous},correctedValues:{...r.correctedValues,category:body.category}});
      return appendAuditEvent({...state,normalizedStatementRows:rows,transactions:state.transactions.map(t=>t.id===row.id?{...t,category:body.category}:t),twinVersion:state.twinVersion+1},'statement_category_correction','succeeded',`用户将账单第${row.rowNumber}行从${previous}修正为${body.category}；金额及权威余额不变。`);
    });res.json(productMission(next));
  }));
  app.post('/api/product/prepare', route((req, res) => {
    const body = z.object({ kind: z.enum(['plan', 'subscription', 'schedule', 'pause', 'cancel', 'resume', 'balance']),
      id: z.string().optional(), recurrence: z.enum(['one_time', 'monthly']).default('monthly'),
      scheduledDate:z.iso.date().optional(), balanceCents: z.number().int().nonnegative().optional(), asOf: z.iso.date().optional() }).strict().parse(req.body);
    if(body.scheduledDate&&(body.kind!=='schedule'||body.recurrence!=='one_time'))throw new Error('SCHEDULE_INVALID_SCOPE');
    const sid = sessionId(req, res), thread = createAgentThread(sid, { title: '旅行任务操作', dedupeKey: 'product-confirmations' });
    let confirmation: { actionId: string; title: string; body: string } | null = null;
    const updated = mutateState(sid, state => {
      if (body.kind === 'balance') {
        const p = prepareAccountSnapshot(sid, thread.id, { accountId: 'checking', balanceCents: body.balanceCents!, currency: 'CNY', asOf: body.asOf! }, state);
        confirmation = { actionId: p.actionId, title: '确认模拟账户余额', body: `将工资卡截至 ${body.asOf} 的余额确认为 ¥${body.balanceCents! / 100}。历史账单、旅行金和应急金不变。` }; return state;
      }
      if (body.kind === 'resume') return resumeTransferSchedule(state, { scheduleId: body.id! }).state;
      if (body.kind === 'subscription') {
        const prepared = prepareSubscriptionConfirmation(sid, thread.id, body.id!, state);
        confirmation = { actionId: prepared.actionId, title: prepared.component.title, body: prepared.component.body }; return prepared.state;
      }
      const view = productMission(state);
      if (body.kind === 'plan') {
        const plan = view.plans.find(item => item.id === body.id); if (!plan?.executable) throw new Error('PLAN_NOT_AVAILABLE');
        const params = { planId: plan.id, planHash: stableHash(plan), monthlyCents: plan.monthlyCents, firstMonthContributionCents: plan.firstMonthContributionCents };
        const approval = createApprovalSnapshot(state, 'product_choose_plan', params, `${state.clock}T12:05:00.000Z`);
        const action = createAgentAction(sid, thread.id, 'product_choose_plan', state.twinVersion, { ...params, approvalId: approval.approval.id, snapshotHash: approval.approval.snapshotHash });
        confirmation = { actionId: action.id, title: '核对旅行目标方案', body: `${plan.label}：每月 ¥${plan.monthlyCents / 100}，首月合计 ¥${plan.firstMonthContributionCents / 100}，预计 ${plan.projectedDate}。本次只选择方案，不转移资金；后续转入需单独确认。` };
        return approval.state;
      }
      if (body.kind === 'pause' || body.kind === 'cancel') {
        const p = prepareTransferScheduleConfirmation(sid, thread.id, state, { action: body.kind, scheduleId: body.id! });
        confirmation = { actionId: p.actionId, title: p.component.title, body: p.component.body }; return p.state;
      }
      const plan = view.plans.find(item => item.monthlyCents === state.goal.monthlyContributionCents && item.firstMonthContributionCents === state.goal.firstMonthContributionCents);
      if (!plan) throw new Error('SCHEDULE_PLAN_CHANGED');
      const salaryStartDate = view.forecast.events.filter(item => item.kind === 'income' && item.label === '工资').map(item => new Date(Date.parse(`${item.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10))[0];
      const startDate=body.scheduledDate??salaryStartDate;
      const input = { goalId: state.goal.id, planOptionId: plan.id, sourceAccountId: 'checking', destinationAccountId: 'goal-wallet',
        amountCents: body.recurrence === 'one_time' ? plan.upfrontCents || plan.monthlyCents : plan.monthlyCents, currency: 'CNY', recurrence: body.recurrence,
        startDate, endDate: body.scheduledDate?startDate:plan.projectedDate, stopAtGoal: true, forecastId: view.forecast.id, twinVersion: state.twinVersion,
        trigger: body.scheduledDate?{type:'fixed_day' as const,day:Number(startDate.slice(-2))}:{ type: 'salary_event' as const, accountId: 'checking', sourceKind: 'bank' as const, category: 'income' as const, classification: 'salary' as const,
          expectedAmountCents: state.finance.monthlyIncomeCents, toleranceBps: 1000, expectedDay: 25, windowStartDay: 23, graceEndDay: 27,
          graceEndTime: '23:59' as const, executeOffsetDays: 1, executeTime: '09:00' as const, missingEventPolicy: 'skip_no_catchup' as const } };
      const p = prepareTransferScheduleConfirmation(sid, thread.id, state, { action: 'activate', input });
      confirmation = { actionId: p.actionId, title: p.component.title, body: p.component.body }; return p.state;
    });
    res.json({ confirmation, snapshot: snapshot(updated) });
  }));
  app.post('/api/product/confirm', route((req, res) => {
    const body = z.object({ actionId: z.string(), decision: z.enum(['confirm', 'cancel']) }).strict().parse(req.body), sid = sessionId(req, res);
    mutateState(sid, state => {
      const action = getAgentAction(sid, body.actionId);
      if (action.actionType !== 'product_choose_plan') return executeWorkspaceAction(sid, action.id, body.decision, state).state;
      if (action.status === 'consumed') return state;
      if (action.status !== 'pending') throw new Error('AGENT_ACTION_NOT_PENDING');
      if (body.decision === 'cancel') { finishAgentAction(sid, action.id, 'cancelled', {}); return state; }
      if (Date.parse(action.expiresAt) < Date.now() || action.twinVersion !== state.twinVersion) throw new Error('TWIN_VERSION_CHANGED');
      const { approvalId, snapshotHash, ...params } = action.payload as { approvalId: string; snapshotHash: string; planId: string; planHash: string; monthlyCents: number; firstMonthContributionCents: number };
      const plan = productMission(state).plans.find(p => p.id === params.planId);
      if (!plan?.executable || stableHash(plan) !== params.planHash) throw new Error('PLAN_NOT_AVAILABLE');
      const approved = confirmApproval(state, approvalId, snapshotHash), next = consumeApproval(approved.state, approved.token, 'product_choose_plan', params);
      const goal = { ...next.goal, selectedPlanId: 'custom', monthlyContributionCents: plan.monthlyCents, firstMonthContributionCents: plan.firstMonthContributionCents, status: 'active' as const };
      finishAgentAction(sid, action.id, 'consumed', { planId: plan.id });
      return appendAuditEvent({ ...next, goal, goals: next.goals.map(g => g.id === goal.id ? goal : g), twinVersion: next.twinVersion + 1 }, 'product_choose_plan', 'succeeded', '已确认目标方案；尚未转移资金。', { approvalId });
    });
    res.json(snapshot(getState(sid)));
  }));
}
