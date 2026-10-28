import type {DemoState,MissionNotification,MissionRepairPreview} from '../shared/contracts.ts';
import {stableHash} from './governance.ts';
import {missionCompletionDate} from '../shared/mission.ts';
import {activeStatementRows} from './statement-import.ts';

export function screenMissionOutcomes(state:DemoState,now=new Date(`${state.clock}T12:00:00+08:00`)):DemoState {
  if(!state.mission?.monitoringEnabled)return state;
  const quiet=state.riskPreferences.quietHours;
  const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(now);
  const inQuiet=!!quiet&&(quiet.start<=quiet.end?clock>=quiet.start&&clock<quiet.end:clock>=quiet.start||clock<quiet.end);
  const paused=!!state.riskPreferences.pausedUntil&&state.riskPreferences.pausedUntil>=state.clock;
  let notifications=[...(state.mission.notifications??[])];
  const add=(kind:MissionNotification['kind'],sourceId:string,goalId:string,body:string,proposedActions:MissionNotification['proposedActions'])=>{
    const subjectKey=stableHash([kind,sourceId]);const existing=notifications.find(n=>n.subjectKey===subjectKey);
    if(existing){if(existing.status==='deferred'&&!inQuiet&&!paused)notifications=notifications.map(n=>n.id===existing.id?{...n,status:'unread'}:n);return;}
    notifications.push({id:`notification:${subjectKey.slice(0,24)}`,subjectKey,goalId,sourceId,kind,status:inQuiet||paused?'deferred':'unread',createdAt:now.toISOString(),body,proposedActions});
  };
  for(const result of state.transferExecutions){
    const schedule=state.transferSchedules.find(s=>s.id===result.scheduleId);if(!schedule)continue;
    if(result.status==='unknown')add('transfer_unknown',result.id,schedule.goalId,'这次转入的结果尚未确定。请先查询原操作，不要重复转账。',['query']);
    else if(result.status==='skipped_missing_trigger')add('missing_salary',result.id,schedule.goalId,'工资未在约定时间内到账，本期已跳过且不会补扣。可以检查收入或预览调整计划。',['pause','replan']);
    else if(result.status==='failed')add('transfer_failed',result.id,schedule.goalId,'这次转入没有完成。请核对余额、账户和原操作状态，再决定如何恢复。',['query','pause','replan']);
    else if(['succeeded','reconciled'].includes(result.status))notifications=notifications.map(n=>n.sourceId===result.id?{...n,status:'resolved'}:n);
  }
  for(const schedule of state.transferSchedules.filter(s=>s.status==='active')){
    const goal=state.goals.find(g=>g.id===schedule.goalId);if(!goal)continue;
    const projected=missionCompletionDate(state.clock,Math.max(0,goal.targetCents-goal.savedCents),schedule.amountCents);
    if(projected&&projected>goal.targetDate)add('goal_changed',stableHash([goal.id,goal.targetCents,goal.targetDate]),goal.id,'目标条件变化后，当前储蓄节奏可能晚于目标日期。请比较新的计划，原授权上限不会自动扩大。',['replan']);
  }
  for(const subscription of state.subscriptions.filter(item=>item.status==='active')){
    const lastCharge=activeStatementRows(state).filter(row=>row.title===subscription.title&&row.category==='subscription'&&row.amountCents<0).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
    if(lastCharge&&-lastCharge.amountCents<subscription.monthlyCents)
      add('subscription_price',subscription.id,state.goal.id,'订阅金额高于最近一次已入账扣费。这不会自动改计划，请先核对商户证据。',['contact_merchant','replan']);
  }
  return {...state,mission:{...state.mission,notifications:notifications.slice(-200)}};
}

export function previewMissionRepairs(state:DemoState):MissionRepairPreview[] {
  const previews:MissionRepairPreview[]=[];
  for(const execution of state.transferExecutions.filter(item=>['failed','unknown','skipped_missing_trigger'].includes(item.status))){
    const schedule=state.transferSchedules.find(item=>item.id===execution.scheduleId);
    if(!schedule)continue;
    if(execution.status==='unknown')previews.push({id:`repair:query:${execution.id}`,sourceId:execution.id,kind:'query_operation',label:'查询原转入结果',explanation:'先核对原操作，不要重复转账。查询不会改写计划。',appliesImmediately:false});
    if(execution.status==='skipped_missing_trigger'){
      previews.push({id:`repair:skip:${execution.id}`,sourceId:execution.id,kind:'skip_period',label:'保持本期跳过',explanation:'工资未按时到账，本期已跳过。确认后仍不补扣。',appliesImmediately:false});
      previews.push({id:`repair:date:${execution.id}`,sourceId:execution.id,kind:'adjust_date',label:'预览调整下一期日期',explanation:'只生成新的预览，不会在确认前改写原计划。',appliesImmediately:false});
    }
    if(['failed','skipped_missing_trigger'].includes(execution.status)){
      previews.push({id:`repair:pause:${execution.id}`,sourceId:execution.id,kind:'pause_schedule',label:'预览暂停储蓄计划',explanation:'暂停需单独确认。确认前计划保持原状态。',appliesImmediately:false});
      previews.push({id:`repair:replan:${execution.id}`,sourceId:execution.id,kind:'replan',label:'预览重新规划',explanation:'重新比较三种节奏。原授权金额和频率不会自动扩大。',appliesImmediately:false});
    }
  }
  return previews;
}
