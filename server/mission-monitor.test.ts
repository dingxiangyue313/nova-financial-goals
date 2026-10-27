import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {screenMissionOutcomes} from './mission-monitor.ts';
import {buildHandoffCasePack} from './handoff.ts';
test('monitor is opt-in, defers quiet hours and deduplicates the same material outcome',()=>{
  const state=createJapanMoneyMissionFixture();
  const schedule={id:'schedule',goalId:state.goal.id} as typeof state.transferSchedules[number];
  state.transferSchedules.push(schedule);state.transferExecutions.push({id:'failed',scheduleId:schedule.id,periodKey:'schedule:2026-11',operationId:null,status:'skipped_missing_trigger',amountCents:100000,createdAt:'2026-11-28T00:00:00+08:00',reason:'missing salary',triggerTransactionId:null});
  assert.equal(screenMissionOutcomes(state).mission!.notifications,undefined);
  state.mission!.monitoringEnabled=true;state.riskPreferences.quietHours={start:'22:00',end:'08:00'};
  const quiet=screenMissionOutcomes(state,new Date('2026-11-28T23:00:00+08:00'));
  assert.equal(quiet.mission!.notifications![0].status,'deferred');
  const shown=screenMissionOutcomes(quiet,new Date('2026-11-29T09:00:00+08:00'));
  assert.equal(shown.mission!.notifications![0].status,'unread');
  assert.equal(screenMissionOutcomes(shown).mission!.notifications!.length,1);
});
test('handoff excludes raw files, account identifiers and merchant free text',()=>{
  const state=createJapanMoneyMissionFixture();state.goal.title='PRIVATE_ACCOUNT_123456';state.normalizedStatementRows[0].rawDescription='PRIVATE_RAW_FILE_CONTENT';
  const pack=buildHandoffCasePack(state,{problem:'import_conflict',evidenceIds:['foreign-private-evidence']});
  assert.equal(JSON.stringify(pack).includes('PRIVATE_'),false);assert.deepEqual(pack.evidenceIds,[]);
});
