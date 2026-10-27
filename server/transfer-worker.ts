import {screenMissionOutcomes} from './mission-monitor.ts';
import { randomUUID } from 'node:crypto';
import type { DemoState, Transaction, TransferExecution, TransferSchedule } from '../shared/contracts.ts';
import { appendAuditEvent, confirmApproval, createApprovalSnapshot, stableHash } from './governance.ts';
import { runBankingTool } from './banking.ts';
import { addIsoDays, buildDatedCashflowForecast } from './cashflow-forecast.ts';
import { assertScheduleAccounts, scheduleParameters } from './transfer-schedules.ts';
import { claimTransferLease,getState,listActiveTransferSchedules,mutateState,releaseTransferLease } from './store.ts';

function shanghaiTime(now:Date) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function matchSalaryEvent(schedule:TransferSchedule,transactions:Transaction[],period?:string):Transaction|null {
  return transactions.filter(t=>t.accountId===schedule.sourceAccountId&&t.sourceKind==='bank'&&t.provenance==='connected_data'&&t.category==='income'&&/工资|\bsalary\b/i.test(t.title)&&t.amountCents>=schedule.trigger.minimumSalaryCents&&t.amountCents<=schedule.trigger.maximumSalaryCents&&Number(t.date.slice(8))>=23&&Number(t.date.slice(8))<=27&&t.date>schedule.createdAt.slice(0,10)&&(!period||t.date.startsWith(period))).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))[0]??null;
}
function saveExecution(state:DemoState,execution:TransferExecution):DemoState {
  return {...state,transferExecutions:[...state.transferExecutions.filter(e=>e.id!==execution.id),execution]};
}
export function executeAuthorizedScheduleTransfer(state:DemoState,schedule:TransferSchedule,key:string) {
  const {source,goal}=assertScheduleAccounts(state,schedule);
  if(schedule.authorizationHash!==stableHash(scheduleParameters(schedule)))throw new Error('APPROVAL_PARAMETERS_CHANGED');
  const fresh=buildDatedCashflowForecast(state,{accountId:source.id,horizonEnd:addIsoDays(state.clock,62),scenario:'baseline'});
  if(fresh.precision!=='exact')throw new Error('DATA_BALANCE_STALE');
  const amountCents=Math.min(schedule.amountCents,Math.min(goal.targetCents,schedule.targetCents)-goal.savedCents);
  if(amountCents<=0)throw new Error('GOAL_ALREADY_ACHIEVED');
  if(source.balanceCents-amountCents<Math.max(0,goal.protectedCents-state.finance.emergencyCents))throw new Error('INSUFFICIENT_BALANCE');
  const draft=runBankingTool(state,'prepare_transfer',{sourceAccountId:source.id,destinationAccountId:schedule.destinationAccountId,amountCents});
  const parameters={draftId:draft.result.draftId,snapshotId:draft.result.snapshotId};
  // Deterministic service derives this occurrence from the user's immutable plan authorization.
  // The model cannot call this path, approve its own tools, or change these parameters.
  const approval=createApprovalSnapshot(draft.state,'execute_transfer',parameters,`${state.clock}T12:05:00.000Z`);
  const permitted=confirmApproval(approval.state,approval.approval.id,approval.approval.snapshotHash);
  const executed=runBankingTool(permitted.state,'execute_transfer',{...parameters,approvalToken:permitted.token,idempotencyKey:key});
  let next=executed.state;const saved=next.accounts.find(a=>a.id===schedule.destinationAccountId)!.balanceCents;
  const updatedGoal={...goal,savedCents:saved,status:saved>=goal.targetCents?'achieved' as const:goal.status};
  next={...next,goals:next.goals.map(g=>g.id===goal.id?updatedGoal:g),goal:next.goal.id===goal.id?updatedGoal:next.goal,
    accountSnapshots:[...next.accountSnapshots,...next.accounts.filter(a=>a.id===source.id||a.id===schedule.destinationAccountId).map(a=>({id:randomUUID(),accountId:a.id,balanceCents:a.balanceCents,currency:a.currency,asOf:state.clock,source:'simulated_connection' as const,confirmed:true,twinVersion:next.twinVersion}))],
    transactions:[...next.transactions,{id:`${executed.result.operationId}:source`,accountId:source.id,date:state.clock,title:'旅行金转入',category:'goal_transfer',amountCents:-amountCents,sourceKind:'bank',provenance:'connected_data'},{id:`${executed.result.operationId}:destination`,accountId:schedule.destinationAccountId,date:state.clock,title:'旅行金转入',category:'goal_transfer',amountCents,sourceKind:'bank',provenance:'connected_data'}],
    transferSchedules:next.transferSchedules.map(s=>s.id===schedule.id&&(schedule.frequency==='one_time'||updatedGoal.status==='achieved'||saved>=schedule.targetCents)?{...s,status:'completed'}:s)};
  if(next.finance.emergencyCents!==state.finance.emergencyCents||next.accounts.find(a=>a.id===source.id)!.balanceCents!==source.balanceCents-amountCents)throw new Error('OPERATION_VERIFY_MISMATCH');
  return {state:next,operationId:String(executed.result.operationId),amountCents};
}
export function processTransferSchedule(sessionId:string,scheduleId:string,now:Date,outcome:'normal'|'timeout_before_commit'|'timeout_after_commit'='normal'):TransferExecution {
  const owner=randomUUID();if(!claimTransferLease(sessionId,scheduleId,owner))throw new Error('SCHEDULE_WORKER_BUSY');
  let result:TransferExecution|undefined;
  try {
    mutateState(sessionId,state=>{
      const schedule=state.transferSchedules.find(s=>s.id===scheduleId);if(!schedule)throw new Error('SCHEDULE_NOT_FOUND');
      const {date,time}=shanghaiTime(now);if(date!==state.clock)throw new Error('DATA_CLOCK_MISMATCH');
      const period=date.slice(0,7),periodKey=`schedule:${schedule.id}:${schedule.frequency==='one_time'?'one_time':period}`;
      const existing=state.transferExecutions.find(e=>e.periodKey===periodKey);
      if(existing&&existing.status!=='scheduled'){result=existing;return state;}
      if(schedule.status!=='active')throw new Error('SCHEDULE_NOT_ACTIVE');
      const execution:TransferExecution={id:`execution:${stableHash(periodKey).slice(0,32)}`,scheduleId,periodKey,operationId:null,status:'scheduled',amountCents:schedule.amountCents,createdAt:now.toISOString(),reason:'等待约定的触发事件和执行时间。',triggerTransactionId:null};
      const finish=(status:TransferExecution['status'],reason:string,next=state)=>{result={...execution,status,reason};return screenMissionOutcomes(appendAuditEvent(saveExecution(next,result),'scheduled_transfer',status,reason));};
      if(date>schedule.endDate)return finish('failed','计划已到期，未执行转账。',{...state,transferSchedules:state.transferSchedules.map(s=>s.id===scheduleId?{...s,status:'completed'}:s)});
      const goal=state.goals.find(g=>g.id===schedule.goalId);
      if(!goal||goal.savedCents>=Math.min(goal.targetCents,schedule.targetCents))return finish('failed','目标已达成或已删除，计划停止。',{...state,transferSchedules:state.transferSchedules.map(s=>s.id===scheduleId?{...s,status:'completed'}:s)});
      let dueDate=date;
      if(schedule.frequency==='monthly'&&schedule.trigger.type==='salary_event'){
        const salary=matchSalaryEvent(schedule,state.transactions,period);
        if(!salary){if(Number(date.slice(8))<=27){result=execution;return saveExecution(state,execution);}return finish('skipped_missing_trigger','27日结束前未检测到匹配工资，本期跳过且不补扣。');}
        execution.triggerTransactionId=salary.id;dueDate=addIsoDays(salary.date,1);
      }else if(schedule.frequency==='monthly')dueDate=`${period}-${String(schedule.trigger.expectedDay).padStart(2,'0')}`;
      if(date<dueDate||(date===dueDate&&time<'09:00')){result=execution;return saveExecution(state,execution);}
      if(schedule.frequency==='monthly'&&date>dueDate)return finish('failed','授权的执行时间已错过，请核对计划；不会自动追补扣款。');
      if(outcome==='timeout_before_commit')return finish('unknown','执行服务未返回结果。请先核对状态，暂不重复转账。');
      try{
        const executed=executeAuthorizedScheduleTransfer(state,schedule,periodKey);
        execution.operationId=executed.operationId;execution.amountCents=executed.amountCents;
        return finish(outcome==='timeout_after_commit'?'unknown':'succeeded',outcome==='timeout_after_commit'?'执行结果待核对，请查询状态。':'已验证到账条件、余额和双方账户，旅行金转入成功。',executed.state);
      }catch(error){return finish('failed',error instanceof Error?error.message:'OPERATION_FAILED');}
    });
    return result!;
  } finally {releaseTransferLease(sessionId,scheduleId,owner);}
}
export function reconcileTransferExecution(sessionId:string,executionId:string) {
  let result:TransferExecution|undefined;
  mutateState(sessionId,state=>{
    const item=state.transferExecutions.find(e=>e.id===executionId);if(!item)throw new Error('TRANSFER_EXECUTION_NOT_FOUND');
    if(item.status!=='unknown'){result=item;return state;}
    const operation=state.operations.find(o=>o.operationId===item.operationId);
    result={...item,status:operation?.status==='executed'?'reconciled':'failed',reason:operation?.status==='executed'?'已核对原操作成功，没有再次转账。':'已核对原操作未执行，没有补扣。'};
    return appendAuditEvent(saveExecution(state,result),'transfer_reconciliation',result.status,result.reason);
  });return result!;
}
export function tickTransferWorker(now?:Date,maxSchedules=100) {
  let processed=0;
  for(const row of listActiveTransferSchedules(maxSchedules)){
    const state=getState(row.sessionId),before=state.transferExecutions;
    try{const result=processTransferSchedule(row.sessionId,row.scheduleId,now??new Date(`${state.clock}T12:00:00+08:00`));if(result.status!=='scheduled'&&!before.some(e=>e.id===result.id&&e.status===result.status))processed++;}
    catch(error){if(!(error instanceof Error)||error.message!=='SCHEDULE_WORKER_BUSY')throw error;}
  }return processed;
}
