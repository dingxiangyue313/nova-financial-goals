import { randomUUID } from 'node:crypto';
import type { DemoState, TransferSchedule, TransferSchedulePreview } from '../shared/contracts.ts';
import { appendAuditEvent, consumeApproval, createApprovalSnapshot, stableHash } from './governance.ts';
import { addIsoDays, buildDatedCashflowForecast, monthDate } from './cashflow-forecast.ts';

export type ScheduleInput = { goalId: string; sourceAccountId: string; destinationAccountId: string; amountCents: number; frequency: 'one_time' | 'monthly'; forecastId: string; endDate?: string; triggerType?: 'salary_event' | 'fixed_day'; fixedDay?: number };
export function scheduleParameters(schedule: TransferSchedule) {
  return { targetCents:schedule.targetCents,id:schedule.id,goalId:schedule.goalId,sourceAccountId:schedule.sourceAccountId,destinationAccountId:schedule.destinationAccountId,currency:schedule.currency,amountCents:schedule.amountCents,frequency:schedule.frequency,trigger:schedule.trigger,endDate:schedule.endDate,forecastId:schedule.forecastId };
}
export function assertScheduleAccounts(state: DemoState,schedule: Pick<TransferSchedule,'sourceAccountId'|'destinationAccountId'|'goalId'>) {
  const source = state.accounts.find(a=>a.id===schedule.sourceAccountId), destination = state.accounts.find(a=>a.id===schedule.destinationAccountId);
  const goal = state.goals.find(g=>g.id===schedule.goalId);
  if (!source || !destination || !goal) throw new Error('ACCOUNT_NOT_FOUND');
  if (source.protected || source.type!=='checking') throw new Error('PROTECTED_ACCOUNT');
  if (source.currency!=='CNY' || destination.currency!=='CNY') throw new Error('CURRENCY_MISMATCH');
  if (destination.type!=='goal' || (destination.goalId ? destination.goalId!==goal.id : destination.id!=='goal-wallet' || goal.id!=='goal-japan-2026')) throw new Error('ACCOUNT_GOAL_MISMATCH');
  if (goal.status!=='active' || goal.targetDate<state.clock) throw new Error('GOAL_NOT_ACTIVE');
  return {source,destination,goal};
}
export function simulateTransferSchedule(state: DemoState,input: ScheduleInput): {state:DemoState;preview:TransferSchedulePreview} {
  if (!['one_time','monthly'].includes(input.frequency) || !Number.isSafeInteger(input.amountCents) || input.amountCents<=0) throw new Error('INVALID_SCHEDULE');
  const {goal,source} = assertScheduleAccounts(state,input);
  if (input.amountCents>goal.targetCents-goal.savedCents) throw new Error('GOAL_TRANSFER_EXCEEDS_REMAINING');
  if (input.frequency==='monthly' && state.transferSchedules.some(s=>s.goalId===goal.id && s.frequency==='monthly' && ['active','paused'].includes(s.status))) throw new Error('SCHEDULE_ALREADY_ACTIVE');
  const horizonEnd = goal.targetDate<addIsoDays(state.clock,366) ? goal.targetDate : addIsoDays(state.clock,366);
  const forecast = buildDatedCashflowForecast(state,{accountId:source.id,horizonEnd,scenario:'baseline'});
  const stored = state.datedForecasts.find(f=>f.forecastId===input.forecastId && f.twinVersion===state.twinVersion && f.precision==='exact' && f.accountId===source.id);
  if (forecast.precision!=='exact' || (!stored && forecast.forecastId!==input.forecastId)) throw new Error('DATA_FORECAST_STALE');
  if (input.endDate && (input.endDate>goal.targetDate || input.endDate<state.clock)) throw new Error('INVALID_END_DATE');
  const triggerType = input.triggerType ?? 'salary_event'; const fixedDay=input.fixedDay ?? 26;
  if (!['salary_event','fixed_day'].includes(triggerType) || !Number.isInteger(fixedDay) || fixedDay<1 || fixedDay>28) throw new Error('INVALID_TRIGGER');
  const schedule: TransferSchedule = {targetCents:goal.targetCents,id:randomUUID(),goalId:goal.id,sourceAccountId:source.id,destinationAccountId:input.destinationAccountId,currency:'CNY',amountCents:input.amountCents,frequency:input.frequency,status:'awaiting_confirmation',
    trigger:{type:triggerType,expectedDay:triggerType==='salary_event'?25:fixedDay,executeOffsetDays:1,executeTime:'09:00',missingEventPolicy:'skip_no_catchup',graceDay:27,minimumSalaryCents:Math.floor(state.finance.monthlyIncomeCents*9/10),maximumSalaryCents:Math.ceil(state.finance.monthlyIncomeCents*11/10),sourceAccountId:source.id},
    createdAt:`${state.clock}T12:00:00+08:00`,endDate:input.endDate ?? goal.targetDate,forecastId:input.forecastId,twinVersion:state.twinVersion,authorizationHash:'',approvalId:null,snapshotHash:null,nextEvaluationDate:state.clock};
  schedule.authorizationHash=stableHash(scheduleParameters(schedule));
  const forecastWithTransfer=buildDatedCashflowForecast(state,{accountId:source.id,horizonEnd,scenario:'baseline',contributionCents:input.frequency==='monthly'?input.amountCents:0});
  const reserve=Math.max(0,goal.protectedCents-state.finance.emergencyCents);
  if ((input.frequency==='one_time'?source.balanceCents-input.amountCents:forecastWithTransfer.minimumBalanceCents ?? -1)<reserve) throw new Error('INSUFFICIENT_BALANCE');
  const first = new Date(`${state.clock}T00:00:00Z`);const day=triggerType==='salary_event'?26:fixedDay;
  const cycles=Array.from({length:input.frequency==='one_time'?1:3},(_,i)=>({expectedDate:input.frequency==='one_time'?state.clock:monthDate(first.getUTCFullYear(),first.getUTCMonth()+(first.getUTCDate()>=day?1:0)+i,day),amountCents:input.amountCents,minimumBalanceCents:forecastWithTransfer.minimumBalanceCents ?? 0}));
  const prepared=createApprovalSnapshot(state,'activate_transfer_schedule',scheduleParameters(schedule),`${state.clock}T12:05:00.000Z`);
  schedule.approvalId=prepared.approval.id;schedule.snapshotHash=prepared.approval.snapshotHash;
  return {state:{...prepared.state,transferSchedules:[...state.transferSchedules,schedule]},preview:{...schedule,cycles,limitations:forecastWithTransfer.limitations}};
}
export function activateTransferSchedule(state: DemoState,input:{scheduleId:string;approvalToken:string}) {
  const schedule=state.transferSchedules.find(s=>s.id===input.scheduleId);if(!schedule)throw new Error('SCHEDULE_NOT_FOUND');
  if(schedule.status==='active'||schedule.status==='completed')return {state,schedule};
  if(schedule.status!=='awaiting_confirmation'||schedule.twinVersion!==state.twinVersion)throw new Error('TWIN_VERSION_CHANGED');
  assertScheduleAccounts(state,schedule);
  if(schedule.authorizationHash!==stableHash(scheduleParameters(schedule)))throw new Error('APPROVAL_PARAMETERS_CHANGED');
  const permitted=consumeApproval(state,input.approvalToken,'activate_transfer_schedule',scheduleParameters(schedule));
  if(schedule.frequency==='monthly'&&state.transferSchedules.some(s=>s.id!==schedule.id&&s.goalId===schedule.goalId&&s.frequency==='monthly'&&['active','paused'].includes(s.status)))throw new Error('SCHEDULE_ALREADY_ACTIVE');
  const active={...schedule,status:'active' as const};
  const next=appendAuditEvent({...permitted,twinVersion:state.twinVersion+1,transferSchedules:state.transferSchedules.map(s=>s.id===active.id?active:s)},'activate_transfer_schedule','succeeded','已确认转入规则及停止条件；创建计划未转账。',{approvalId:schedule.approvalId!});
  return {state:next,schedule:active};
}
export function prepareScheduleLifecycle(state:DemoState,id:string,action:'pause'|'resume'|'cancel') {
  const schedule=state.transferSchedules.find(s=>s.id===id);if(!schedule||!['active','paused'].includes(schedule.status))throw new Error('SCHEDULE_NOT_ACTIVE');
  if((action==='pause'&&schedule.status!=='active')||(action==='resume'&&schedule.status!=='paused'))throw new Error('SCHEDULE_INVALID_TRANSITION');
  if(action==='resume'){assertScheduleAccounts(state,schedule);if(schedule.authorizationHash!==stableHash(scheduleParameters(schedule)))throw new Error('APPROVAL_PARAMETERS_CHANGED');}
  return createApprovalSnapshot(state,`${action}_transfer_schedule`,{scheduleId:id,authorizationHash:schedule.authorizationHash},`${state.clock}T12:05:00.000Z`);
}
export function applyScheduleLifecycle(state:DemoState,id:string,action:'pause'|'resume'|'cancel',approvalToken:string) {
  const schedule=state.transferSchedules.find(s=>s.id===id);if(!schedule)throw new Error('SCHEDULE_NOT_FOUND');
  prepareScheduleLifecycle(state,id,action); // Recheck current transition and authority; no state is persisted here.
  const permitted=consumeApproval(state,approvalToken,`${action}_transfer_schedule`,{scheduleId:id,authorizationHash:schedule.authorizationHash});
  const updated={...schedule,status:action==='pause'?'paused' as const:action==='resume'?'active' as const:'cancelled' as const};
  return {state:appendAuditEvent({...permitted,twinVersion:state.twinVersion+1,transferSchedules:state.transferSchedules.map(s=>s.id===id?updated:s)},`${action}_transfer_schedule`,'succeeded','已按确认内容更新储蓄计划。'),schedule:updated};
}
