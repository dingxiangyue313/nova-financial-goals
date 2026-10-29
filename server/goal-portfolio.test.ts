import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoStateSchema,TransferExecutionSchema,type DemoState} from '../shared/contracts.ts';
import {GoalContractTermsSchema} from '../shared/goal-contract.ts';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,describeServiceAction,executeServiceAction,validateServiceBalances,requestTravelQuotes} from './financial-services.ts';
import {buildGoalPortfolio,goalContract,changedGoalContract,applyGoalContract} from './goal-portfolio.ts';
import {runBankingTool} from './banking.ts';
import {verifyAuditChain,createApprovalSnapshot,confirmApproval} from './governance.ts';
import {buildDatedCashflowForecast} from './cashflow-forecast.ts';
import {buildMoneyMissionPlans} from './money-mission-plans.ts';
import {simulateTransferSchedule,transferScheduleApprovalParameters,activateTransferSchedule,resumeTransferSchedule} from './transfer-schedules.ts';
const terms=(s:DemoState,id=s.goal.id)=>GoalContractTermsSchema.strip().parse(goalContract(s,s.goals.find(g=>g.id===id)!));
function conflict(){
 let state=initializeServices(createJapanMoneyMissionFixture());
 const first={...state.goal,targetCents:260000,monthlyContributionCents:20000,targetDate:'2027-01-26',flexibilityWeeks:0};
 const second={...first,id:'training',title:'培训',targetCents:60000,savedCents:0};
 state={...state,goal:first,goals:[first,second],finance:{...state.finance,checkingCents:120000,monthlyIncomeCents:100000},
  accounts:state.accounts.map(a=>a.id==='checking'?{...a,balanceCents:120000}:a),accountSnapshots:state.accountSnapshots.map(a=>a.accountId==='checking'?{...a,balanceCents:120000}:a),
  transactions:state.transactions.map(t=>t.title==='工资'?{...t,amountCents:100000}:t),subscriptions:[],bills:[{id:'rent',title:'租金',amountCents:80000,dueDate:'2026-11-05',paid:false}]};
 for(const goal of state.goals)state=applyGoalContract(state,changedGoalContract(state,{...terms(state,goal.id),priority:goal.id===first.id?1:5,maxExtensionDays:goal.id===first.id?0:60}));
 return state;
}
test('baseline portfolio is read-only, dated and does not count future income as current coverage',()=>{
 const state=initializeServices(createJapanMoneyMissionFixture()),before=structuredClone(state),model=buildGoalPortfolio(state);
 assert.equal(model.status,'on_track');assert.equal(model.current.minimumBalanceCents,317200);
 assert.equal(model.goals[0].coveredCents,200000);assert.equal(model.goals[0].projectedDate,'2027-04-26');
 assert.equal(model.options.length,0);assert.deepEqual(state,before);assert.deepEqual(buildGoalPortfolio(state),model);
});
test('shared cash conflict is repaired first in the lower priority goal within exact allowed ranges',()=>{
 const state=conflict(),before=structuredClone(state),model=buildGoalPortfolio(state);
 assert.equal(model.status,'needs_adjustment');assert.equal(model.current.shortfallCents,20000);assert.equal(model.current.minimumBalanceDate,'2027-02-05');
 assert.ok(model.options.length>0&&model.options.length<=3);
 const option=model.options.find(o=>o.label==='在允许范围内延后，减少改动')!;assert.ok(option);
 assert.equal(option.changes.length,1);assert.equal(option.changes[0].goalId,'training');assert.equal(option.changes[0].monthlyCents,13333);assert.equal(option.changes[0].targetDate,'2027-03-26');
 const raw={kind:'portfolio_repair',optionId:option.id,expectedTwinVersion:state.twinVersion};
 const preview=describeServiceAction(state,raw);assert.deepEqual(state,before);
 const next=executeServiceAction(state,raw,'repair');validateServiceBalances(state,next);
 assert.deepEqual(next.accounts,state.accounts);assert.deepEqual(next.finance,state.finance);assert.deepEqual(next.financialServices.mandates,state.financialServices.mandates);
 assert.equal(next.goals.find(g=>g.id==='training')!.monthlyContributionCents,13333);assert.equal(next.goals[0].monthlyContributionCents,20000);
 const repaired=goalContract(next,next.goals[1]);assert.equal(repaired.monthlyContributionCents+repaired.maxMonthlyIncreaseCents,20000);assert.equal(repaired.maxExtensionDays,1);
 assert.equal(buildGoalPortfolio(next).current.shortfallCents,0);assert.equal(buildGoalPortfolio(next).status,'on_track');assert.ok(verifyAuditChain(next.audit));
 assert.equal(executeServiceAction(next,raw,'repair'),next);assert.ok(Array.isArray(preview.details.changes));
 assert.throws(()=>describeServiceAction({...state,twinVersion:state.twinVersion+1},raw),/TWIN_VERSION_CHANGED/);
});
test('hard deadlines, exact budget and insufficient data cannot be bypassed by a forged option',()=>{
 const state=conflict();state.financialServices.goalContracts=state.financialServices.goalContracts.map(c=>({...c,maxExtensionDays:0}));
 assert.equal(buildGoalPortfolio(state).options.length,0);
 assert.throws(()=>describeServiceAction(state,{kind:'portfolio_repair',optionId:'invented',expectedTwinVersion:state.twinVersion}),/OPTION_STALE/);
 const stale={...state,accountSnapshots:state.accountSnapshots.filter(a=>a.accountId!=='checking')};
 assert.equal(buildGoalPortfolio(stale).status,'insufficient_data');assert.equal(buildGoalPortfolio(stale).options.length,0);
 const far={...state,goals:state.goals.map(g=>({...g,targetDate:'2029-01-01'}))};assert.equal(buildGoalPortfolio(far).status,'insufficient_data');
});
test('editing a versioned contract changes no funds and rejects old revision, preserves old grants and wallet ownership',()=>{
 let state=initializeServices(createJapanMoneyMissionFixture());
 state=executeServiceAction(state,{kind:'mandate',goalId:state.goal.id,accountId:'goal-wallet',maxPerOrderCents:300000,totalCents:500000,merchants:['air-demo','stay-demo'],expiresAt:new Date(Date.now()+86400000).toISOString()},'original-grant');
 const raw={...terms(state),kind:'goal_contract',expectedRevision:0,priority:1,targetCents:900000,allowPayments:false};
 const next=executeServiceAction(state,raw,'contract');validateServiceBalances(state,next);assert.ok(DemoStateSchema.safeParse(next).success);
 assert.equal(next.financialServices.goalContracts[0].revision,1);assert.equal(next.goal.targetCents,900000);assert.equal(next.goal.savedCents,state.goal.savedCents);
 assert.equal(next.goal.selectedPlanId,null);assert.equal(next.goal.status,'draft');assert.deepEqual(next.accounts,state.accounts);assert.deepEqual(next.financialServices.allocations,state.financialServices.allocations);assert.deepEqual(next.financialServices.mandates,state.financialServices.mandates);
 assert.throws(()=>describeServiceAction(next,raw),/CONTRACT_CHANGED/);
 const quoted=requestTravelQuotes(next);assert.throws(()=>describeServiceAction(quoted,{kind:'book',quoteIds:quoted.financialServices.quotes.map(q=>q.id),accountId:'goal-wallet',cardId:'card-travel',goalId:state.goal.id,mandateId:'original-grant'}),/GOAL_PAYMENT_NOT_ALLOWED/);
});
function scheduled(){
 let state=initializeServices(createJapanMoneyMissionFixture());
 const forecast=buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd:state.goal.targetDate,scenario:'baseline'}),plan=buildMoneyMissionPlans(state,forecast)[1];
 state={...state,goal:{...state.goal,selectedPlanId:plan.id,status:'active',firstMonthContributionCents:100000}};state.goals=[state.goal];
 const preview=simulateTransferSchedule(state,{goalId:state.goal.id,planOptionId:plan.id,forecastId:forecast.id,twinVersion:state.twinVersion,sourceAccountId:'checking',destinationAccountId:'goal-wallet',currency:'CNY',amountCents:100000,recurrence:'monthly',startDate:'2026-11-26',endDate:'2027-04-26',stopAtGoal:true,
  trigger:{type:'salary_event',accountId:'checking',sourceKind:'bank',category:'income',classification:'salary',expectedAmountCents:850000,toleranceBps:1000,expectedDay:25,windowStartDay:23,graceEndDay:27,graceEndTime:'23:59',executeOffsetDays:1,executeTime:'09:00',missingEventPolicy:'skip_no_catchup'}});
 const created=createApprovalSnapshot({...state,transferSchedulePreviews:[preview]},'activate_transfer_schedule',transferScheduleApprovalParameters(preview),state.clock+'T12:05:00.000Z');
 const confirmed=confirmApproval(created.state,created.approval.id,created.approval.snapshotHash);
 return activateTransferSchedule(confirmed.state,{previewId:preview.id,approvalToken:confirmed.token}).state;
}
test('contract edits pause real authorized schedules and cannot revive the old authority after restoring goal fields',()=>{
 const state=scheduled(),before=structuredClone(state),raw={...terms(state),kind:'goal_contract',expectedRevision:0,priority:1};
 const next=executeServiceAction(state,raw,'contract');assert.equal(next.transferSchedules[0].status,'paused');assert.equal(next.transferSchedules[0].nextEvaluationAt,null);
 const restored={...next,goal:state.goal,goals:state.goals};assert.throws(()=>resumeTransferSchedule(restored,{scheduleId:next.transferSchedules[0].id}),/AUTHORITY_CHANGED/);
 assert.deepEqual(next.accounts,before.accounts);assert.deepEqual(next.finance,before.finance);
});
test('an unresolved scheduled debit must be reconciled before editing its goal',()=>{
 const state=scheduled();state.transferExecutions=[TransferExecutionSchema.parse({id:'unknown',scheduleId:state.transferSchedules[0].id,period:'2026-11',status:'unknown',amountCents:100000,currency:'CNY',operationId:null,triggerTransactionId:null,scheduledAt:null,executedAt:null,receiptOperationId:null,reason:'RECONCILIATION_REQUIRED',createdAt:state.clock+'T12:00:00.000Z',updatedAt:state.clock+'T12:00:00.000Z'})];
 assert.throws(()=>describeServiceAction(state,{...terms(state),kind:'goal_contract',expectedRevision:0,priority:1}),/OPERATION_STATUS_REQUIRED/);
});
test('protection required by a secondary goal is enforced by both financial and original banking tools',()=>{
 const state=conflict(),goal=state.goals[1];state.goals[1]={...goal,protectedCents:state.finance.emergencyCents+110000};
 assert.throws(()=>describeServiceAction(state,{kind:'transfer',recipientId:'contact-1',recipientVersion:1,accountId:'checking',amountCents:20000}),/INSUFFICIENT_AVAILABLE_FUNDS/);
 assert.throws(()=>runBankingTool(state,'prepare_transfer',{sourceAccountId:'checking',destinationAccountId:'goal-wallet',amountCents:20000}),/PROTECTED_FUNDS_UNAVAILABLE/);
 assert.equal((runBankingTool(state,'risk_check',{sourceAccountId:'checking',amountCents:20000}).result as {allowed:boolean}).allowed,false);
 assert.equal(buildGoalPortfolio(state).reservedCents,110000);
});
