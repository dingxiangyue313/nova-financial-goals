import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { DemoState } from '../shared/contracts.ts';
import { createAgentAction,createAgentThread } from './store.ts';
import { confirmApproval,stableHash } from './governance.ts';
import { prepareSubscriptionAction,executeSubscriptionCancellation } from './subscription-service.ts';
import { simulateTransferSchedule,activateTransferSchedule,prepareScheduleLifecycle,applyScheduleLifecycle } from './transfer-schedules.ts';
import { executeAuthorizedScheduleTransfer } from './transfer-worker.ts';
import { addIsoDays,buildDatedCashflowForecast } from './cashflow-forecast.ts';

export function prepareMoneyMissionAction(sessionId:string,state:DemoState,input:{kind:'cancel_subscription'|'create_schedule'|'pause_schedule'|'resume_schedule'|'cancel_schedule';amountCents?:number;frequency?:'once'|'monthly';triggerType?:'salary_event'|'fixed_day';fixedDay?:number;threadId?:string}) {
  const threadId=input.threadId??createAgentThread(sessionId,{title:'旅行资金操作确认',dedupeKey:'money-mission-confirmations'}).id;
  let next=state,actionType='',payload:Record<string,unknown>,relatedId='';let amountCents=input.amountCents??100000;
  if(input.kind==='cancel_subscription'){
    const prepared=prepareSubscriptionAction(state,{subscriptionId:'cloudbox',action:'cancel'});next=prepared.state;relatedId=prepared.action.id;
    actionType='confirm_subscription_cancellation';payload={relatedId,approvalId:prepared.action.approvalId,snapshotHash:prepared.action.snapshotHash};
  }else if(input.kind==='create_schedule'){
    const horizonEnd=state.goal.targetDate<=addIsoDays(state.clock,366)?state.goal.targetDate:addIsoDays(state.clock,366);
    const forecast=buildDatedCashflowForecast(state,{accountId:'checking',horizonEnd,scenario:'baseline'});
    const prepared=simulateTransferSchedule(state,{goalId:state.goal.id,sourceAccountId:'checking',destinationAccountId:'goal-wallet',amountCents,frequency:input.frequency==='once'?'one_time':'monthly',forecastId:forecast.forecastId??'',triggerType:input.triggerType,fixedDay:input.fixedDay});next=prepared.state;relatedId=prepared.preview.id;
    actionType='activate_transfer_schedule';payload={relatedId,approvalId:prepared.preview.approvalId,snapshotHash:prepared.preview.snapshotHash};
  }else{
    const schedule=state.transferSchedules.find(s=>s.goalId===state.goal.id&&['active','paused'].includes(s.status));if(!schedule)throw new Error('SCHEDULE_NOT_ACTIVE');
    const mode=input.kind==='pause_schedule'?'pause':input.kind==='resume_schedule'?'resume':'cancel';
    const prepared=prepareScheduleLifecycle(state,schedule.id,mode);next=prepared.state;relatedId=schedule.id;amountCents=schedule.amountCents;
    actionType=`${mode}_transfer_schedule`;payload={relatedId,approvalId:prepared.approval.id,snapshotHash:prepared.approval.snapshotHash};
  }
  const action=createAgentAction(sessionId,threadId,actionType,state.twinVersion,payload);
  return {state:{...next,mission:next.mission?{...next.mission,pending:{id:action.id,kind:input.kind,amountCents,frequency:input.frequency??'monthly',twinVersion:state.twinVersion,expiresAt:Date.parse(action.expiresAt),fingerprint:stableHash(payload),relatedId}}:undefined},action,threadId};
}
export const MISSION_ACTION_TYPES=['confirm_subscription_cancellation','activate_transfer_schedule','pause_transfer_schedule','resume_transfer_schedule','cancel_transfer_schedule'];
export function executePreparedMoneyMissionAction(state:DemoState,actionType:string,raw:unknown) {
  const payload=z.object({relatedId:z.string(),approvalId:z.string(),snapshotHash:z.string()}).strict().parse(raw);
  const approved=confirmApproval(state,payload.approvalId,payload.snapshotHash);let next:DemoState;
  if(actionType==='confirm_subscription_cancellation')next=executeSubscriptionCancellation(approved.state,{actionId:payload.relatedId,approvalToken:approved.token},state.mission?.demoOutcome??'succeeded').state;
  else if(actionType==='activate_transfer_schedule'){
    const activated=activateTransferSchedule(approved.state,{scheduleId:payload.relatedId,approvalToken:approved.token});next=activated.state;
    if(activated.schedule.frequency==='one_time'){
      const key=`schedule:${activated.schedule.id}:one_time`;const executed=executeAuthorizedScheduleTransfer(next,activated.schedule,key);next={...executed.state,transferExecutions:[...executed.state.transferExecutions,{id:randomUUID(),scheduleId:activated.schedule.id,periodKey:key,operationId:executed.operationId,status:'succeeded',amountCents:executed.amountCents,createdAt:`${state.clock}T12:00:00+08:00`,reason:'一次性旅行金已转入，双方账户余额已核对。',triggerTransactionId:null}]};
    }
  }else next=applyScheduleLifecycle(approved.state,payload.relatedId,actionType==='pause_transfer_schedule'?'pause':actionType==='resume_transfer_schedule'?'resume':'cancel',approved.token).state;
  if(next.mission)next={...next,mission:{...next.mission,pending:null,demoOutcome:undefined}};
  const subscription=next.subscriptionActions.find(a=>a.id===payload.relatedId);
  return {state:next,detail:subscription?(subscription.nextChargeSuppressed?'商户已验证关闭未来续费，已付费服务保持至期末。':subscription.status==='unknown'?'取消结果待核对；请先查询，尚未计入节省。':'取消未成功，请按商户结果恢复处理。'):'已按准确的确认内容更新旅行储蓄安排。'};
}
