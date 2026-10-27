import type {Express,Request,Response,RequestHandler} from 'express';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {getState,mutateState,getAgentAction} from './store.ts';
import {snapshot} from './presentation.ts';
import {readMoneyMission} from './money-mission.ts';
import {buildBillBrief,inspectEvidence} from './bill-analysis.ts';
import {activeStatementRows} from './statement-import.ts';
import {addIsoDays,buildDatedCashflowForecast} from './cashflow-forecast.ts';
import {prepareMoneyMissionAction} from './money-mission-actions.ts';
import {executeWorkspaceAction} from './workspace.ts';
import {reconcileSubscriptionCancellation,prepareSubscriptionAction} from './subscription-service.ts';
import {processTransferSchedule,reconcileTransferExecution,tickTransferWorker} from './transfer-worker.ts';
import {buildHandoffCasePack} from './handoff.ts';
import {appendAuditEvent} from './governance.ts';

export function registerMoneyMissionRoutes(app:Express,sessionId:(req:Request,res:Response)=>string,route:(fn:(req:Request,res:Response)=>unknown)=>RequestHandler){
  app.get('/api/money-mission',route((req,res)=>res.json(readMoneyMission(getState(sessionId(req,res))))));
  app.post('/api/mission/start',route((req,res)=>res.json(snapshot(mutateState(sessionId(req,res),s=>s.mission||s.goals.length?s:createJapanMoneyMissionFixture())))));
  app.post('/api/mission/load',route((req,res)=>res.json(snapshot(mutateState(sessionId(req,res),s=>appendAuditEvent({...createJapanMoneyMissionFixture(),twinVersion:s.twinVersion+1},'mission_loaded','ready','已载入合成旅行任务'))))));
  app.get('/api/mission/forecast',route((req,res)=>{
    const s=getState(sessionId(req,res)),amount=z.coerce.number().int().min(0).max(10000000).default(100000).parse(req.query.amount),horizonEnd=addIsoDays(s.clock,62);
    const baseline=buildDatedCashflowForecast(s,{accountId:'checking',horizonEnd,scenario:'baseline',contributionCents:amount}),stress=buildDatedCashflowForecast(s,{accountId:'checking',horizonEnd,scenario:'stress',contributionCents:amount});
    res.json({lowCents:baseline.minimumBalanceCents,lowDate:baseline.minimumBalanceDate,stressLowCents:stress.minimumBalanceCents,events:baseline.events.map(e=>({date:e.date,title:e.label,cents:e.amountCents,balanceCents:e.balanceCents})),assumption:[...baseline.assumptions,...baseline.limitations].join(' '),precision:baseline.precision,dataAsOf:baseline.dataAsOf});
  }));
  const prepareBody=z.object({kind:z.enum(['cancel_subscription','create_schedule','pause_schedule','resume_schedule','cancel_schedule']),amountCents:z.number().int().positive().max(10000000).default(100000),frequency:z.enum(['once','monthly']).default('monthly'),triggerType:z.enum(['salary_event','fixed_day']).optional(),fixedDay:z.number().int().min(1).max(28).optional()}).strict();
  app.post('/api/mission/prepare',route((req,res)=>{const id=sessionId(req,res),body=prepareBody.parse(req.body);res.json(snapshot(mutateState(id,s=>prepareMoneyMissionAction(id,s,body).state)));}));
  app.post('/api/mission/confirm',route((req,res)=>{
    const id=sessionId(req,res),body=z.object({requestId:z.string().uuid(),confirmed:z.literal(true)}).strict().parse(req.body);
    res.json(snapshot(mutateState(id,s=>{const action=getAgentAction(id,body.requestId);if(action.status==='pending'&&(action.twinVersion!==s.twinVersion||Date.parse(action.expiresAt)<Date.now()))throw new Error('TWIN_VERSION_CHANGED');return executeWorkspaceAction(id,action.id,'confirm',s).state;})));
  }));
  app.post('/api/mission/dismiss',route((req,res)=>{const id=sessionId(req,res);res.json(snapshot(mutateState(id,s=>s.mission?.pending?executeWorkspaceAction(id,s.mission.pending.id,'cancel',s).state:s)));}));
  app.post('/api/mission/reconcile',route((req,res)=>res.json(snapshot(mutateState(sessionId(req,res),s=>{const action=s.subscriptionActions.find(a=>a.subscriptionId==='cloudbox'&&a.status==='unknown');return action?reconcileSubscriptionCancellation(s,action.id).state:s;})))));
  app.post('/api/mission/preference',route((req,res)=>{
    const preference=z.enum(['keep','remind','ignored']).parse(req.body.preference);
    res.json(snapshot(mutateState(sessionId(req,res),s=>{if(!s.mission)throw new Error('DATA_MISSION_NOT_LOADED');const prepared=prepareSubscriptionAction(s,{subscriptionId:'cloudbox',action:preference==='ignored'?'not_subscription':preference});return appendAuditEvent({...prepared.state,mission:{...s.mission,subscription:{...s.mission.subscription,preference}}},'subscription_preference','saved','已保存用户的订阅判断或提醒选择。');})));
  }));
  app.post('/api/money-mission/bill-brief',route((req,res)=>{const input=z.object({periodStart:z.iso.date(),periodEnd:z.iso.date()}).strict().parse(req.body);res.json(buildBillBrief(getState(sessionId(req,res)),input));}));
  app.get('/api/money-mission/evidence/:id',route((req,res)=>{const s=getState(sessionId(req,res)),evidence=inspectEvidence(s,req.params.id);res.json({evidence,transactions:activeStatementRows(s).filter(r=>evidence.transactionIds.includes(r.id)).map(({rawDescription:_raw,...row})=>row)});}));
  app.post('/api/money-mission/transfer-schedules/preview',route((req,res)=>{const id=sessionId(req,res),body=prepareBody.omit({kind:true}).parse(req.body);let actionId='';const state=mutateState(id,s=>{const prepared=prepareMoneyMissionAction(id,s,{kind:'create_schedule',...body});actionId=prepared.action.id;return prepared.state;});res.json({snapshot:snapshot(state),actionId,preview:readMoneyMission(state).schedules.at(-1)});}));
  app.get('/api/money-mission/transfer-schedules/:id',route((req,res)=>{const model=readMoneyMission(getState(sessionId(req,res))),schedule=model.schedules.find(s=>s.id===req.params.id);if(!schedule)throw new Error('SCHEDULE_NOT_FOUND');res.json({schedule,executions:model.executions.filter(e=>e.scheduleId===schedule.id)});}));
  app.post('/api/money-mission/transfer-executions/:id/reconcile',route((req,res)=>{const id=sessionId(req,res),execution=reconcileTransferExecution(id,req.params.id);res.json({execution,snapshot:snapshot(getState(id))});}));
  app.post('/api/money-mission/handoff',route((req,res)=>{const body=z.object({problem:z.enum(['subscription_requires_merchant','import_conflict','transfer_failed','unsupported']),evidenceIds:z.array(z.string()).max(20).optional()}).strict().parse(req.body);let pack:ReturnType<typeof buildHandoffCasePack>|undefined;mutateState(sessionId(req,res),s=>{pack=buildHandoffCasePack(s,body);return {...s,handoffCasePacks:[...s.handoffCasePacks,pack]};});res.json(pack);}));
  app.get('/api/money-mission/handoff/:id',route((req,res)=>{const pack=getState(sessionId(req,res)).handoffCasePacks.find(p=>p.id===req.params.id);if(!pack)throw new Error('HANDOFF_NOT_FOUND');res.json(pack);}));
  app.post('/api/mission/demo-clock',route((req,res)=>{const date=z.iso.date().parse(req.body.date),id=sessionId(req,res);mutateState(id,s=>{if(date<s.clock)throw new Error('INVALID_CLOCK_BACKWARDS');return {...s,clock:date,twinVersion:s.twinVersion+1};});tickTransferWorker();res.json(snapshot(getState(id)));}));
  app.post('/api/mission/demo-event',route((req,res)=>{
    const kind=z.enum(['salary','missing_salary','cancel_timeout','cancel_failure']).parse(req.body.kind),id=sessionId(req,res);
    mutateState(id,s=>{
      if(!s.mission)throw new Error('DATA_MISSION_NOT_LOADED');
      if(kind.startsWith('cancel_'))return {...s,mission:{...s.mission,demoOutcome:kind==='cancel_timeout'?'unknown':'failed'}};
      if(kind==='missing_salary')return {...s,clock:'2026-11-28',twinVersion:s.twinVersion+1};
      if(s.transactions.some(t=>t.id==='salary-11-verified'))return s;
      if(s.clock>'2026-11-26')throw new Error('INVALID_CLOCK_BACKWARDS');
      const forecast=buildDatedCashflowForecast(s,{accountId:'checking',horizonEnd:'2026-11-26',scenario:'baseline',contributionCents:0});
      const balance=s.finance.checkingCents+forecast.events.filter(e=>!e.id.startsWith('transfer:')).reduce((sum,e)=>sum+e.amountCents,0);
      return {...s,clock:'2026-11-26',twinVersion:s.twinVersion+1,finance:{...s.finance,checkingCents:balance,updatedAt:'2026-11-26'},accounts:s.accounts.map(a=>a.id==='checking'?{...a,balanceCents:balance}:a),accountSnapshots:[...s.accountSnapshots,{id:randomUUID(),accountId:'checking',balanceCents:balance,currency:'CNY',asOf:'2026-11-26',source:'simulated_connection',confirmed:true,twinVersion:s.twinVersion+1}],transactions:[...s.transactions,{id:'salary-11-verified',accountId:'checking',date:'2026-11-25',title:'星河设计 · 工资',category:'income',amountCents:850000,sourceKind:'bank',provenance:'connected_data'}]};
    });
    if(kind==='salary'||kind==='missing_salary')tickTransferWorker();res.json(snapshot(getState(id)));
  }));
}
