import type {DemoState,MissionNotification} from '../shared/contracts.ts';
import {stableHash} from './governance.ts';
import {missionCompletionDate} from '../shared/mission.ts';

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
  return {...state,mission:{...state.mission,notifications:notifications.slice(-200)}};
}
