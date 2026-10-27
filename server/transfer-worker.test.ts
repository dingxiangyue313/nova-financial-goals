import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { simulateTransferSchedule, activateTransferSchedule } from './transfer-schedules.ts';
import { confirmApproval } from './governance.ts';
import { getState,mutateState } from './store.ts';
import { matchSalaryEvent,processTransferSchedule,reconcileTransferExecution } from './transfer-worker.ts';

function active() {
  const state=createJapanMoneyMissionFixture();const forecast=buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd:state.goal.targetDate,scenario:'baseline'});
  const preview=simulateTransferSchedule(state,{goalId:state.goal.id,sourceAccountId:'checking',destinationAccountId:'goal-wallet',amountCents:100000,frequency:'monthly',forecastId:forecast.forecastId!});
  const approved=confirmApproval(preview.state,preview.preview.approvalId!,preview.preview.snapshotHash!);
  return activateTransferSchedule(approved.state,{scheduleId:preview.preview.id,approvalToken:approved.token});
}
test('verified salary executes through banking primitives once and survives replay',()=>{
  const result=active(),id=randomUUID();const state=result.state;
  const salary={id:'salary-nov',accountId:'checking',date:'2026-11-25',title:'星河设计 · 工资',category:'income',amountCents:850000,sourceKind:'bank' as const,provenance:'connected_data' as const};
  const ready={...state,clock:'2026-11-26',finance:{...state.finance,checkingCents:1167200,updatedAt:'2026-11-26'},accounts:state.accounts.map(a=>a.id==='checking'?{...a,balanceCents:1167200}:a),accountSnapshots:[...state.accountSnapshots,{...state.accountSnapshots[0],id:randomUUID(),asOf:'2026-11-26',balanceCents:1167200,twinVersion:state.twinVersion}],transactions:[...state.transactions,salary]};
  mutateState(id,()=>ready);
  const first=processTransferSchedule(id,result.schedule.id,new Date('2026-11-26T09:00:00+08:00'));
  assert.equal(first.status,'succeeded');assert.equal(getState(id).goal.savedCents,300000);
  assert.equal(getState(id).finance.emergencyCents,2000000);
  assert.equal(processTransferSchedule(id,result.schedule.id,new Date('2026-11-26T09:05:00+08:00')).operationId,first.operationId);
  assert.equal(matchSalaryEvent(result.schedule,[{...salary,sourceKind:'wechat_pay'}]),null);
  assert.equal(matchSalaryEvent(result.schedule,[{...salary,provenance:'uploaded_statement'}]),null);
});
test('missing trigger is durably skipped and late salary cannot revive the period',()=>{
  const result=active(),id=randomUUID();mutateState(id,()=>({...result.state,clock:'2026-11-28'}));
  const skipped=processTransferSchedule(id,result.schedule.id,new Date('2026-11-28T00:00:00+08:00'));
  assert.equal(skipped.status,'skipped_missing_trigger');
  mutateState(id,s=>({...s,clock:'2026-11-30',transactions:[...s.transactions,{id:'late',accountId:'checking',date:'2026-11-29',title:'工资',category:'income',amountCents:850000,sourceKind:'bank'}]}));
  assert.equal(processTransferSchedule(id,result.schedule.id,new Date('2026-11-30T09:00:00+08:00')).id,skipped.id);
  assert.equal(getState(id).goal.savedCents,200000);
});

for (const outcome of ['timeout_before_commit', 'timeout_after_commit'] as const) {
  test(`${outcome} reconciles the original operation without a second transfer`, () => {
    const { state, schedule } = active(); const sessionId = randomUUID();
    const salary = { id: 'verified-november-salary', accountId: 'checking', date: '2026-11-25', title: '工资', category: 'income', amountCents: 850000, sourceKind: 'bank' as const, provenance: 'connected_data' as const };
    mutateState(sessionId, () => ({ ...state, clock: '2026-11-26',
      finance: { ...state.finance, checkingCents: 1167200, updatedAt: '2026-11-26' },
      accounts: state.accounts.map(account => account.id === 'checking' ? { ...account, balanceCents: 1167200 } : account),
      accountSnapshots: [...state.accountSnapshots, { ...state.accountSnapshots[0], id: randomUUID(), asOf: '2026-11-26', balanceCents: 1167200, twinVersion: state.twinVersion }],
      transactions: [...state.transactions, salary] }));
    const now = new Date('2026-11-26T09:00:00+08:00');
    const unknown = processTransferSchedule(sessionId, schedule.id, now, outcome);
    assert.equal(unknown.status, 'unknown');
    const saved = outcome === 'timeout_after_commit' ? 300000 : 200000;
    assert.equal(getState(sessionId).goal.savedCents, saved);
    assert.equal(processTransferSchedule(sessionId, schedule.id, now).id, unknown.id);
    const reconciled = reconcileTransferExecution(sessionId, unknown.id);
    assert.equal(reconciled.status, outcome === 'timeout_after_commit' ? 'reconciled' : 'failed');
    assert.equal(getState(sessionId).goal.savedCents, saved);
    assert.deepEqual(reconcileTransferExecution(sessionId, unknown.id), reconciled);
    assert.equal(processTransferSchedule(sessionId, schedule.id, now).status, reconciled.status);
    assert.equal(getState(sessionId).finance.emergencyCents, 2000000);
  });
}
