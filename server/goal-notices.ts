import type {DemoState} from '../shared/contracts.ts';import {goalProgress} from './fulfillment.ts';import {notificationDelivery} from './risk.ts';import {stableHash,appendAuditEvent} from './governance.ts';
export function tickGoalNotices(input:DemoState,now=new Date()){
 const s=structuredClone(input);let changed=false;
 for(const goal of s.goals){const p=goalProgress(s,goal.id),issues=s.financialServices.bookings.filter(b=>b.goalId===goal.id&&(b.status==='unknown'||b.status==='refund_pending'||b.status==='failed'&&!s.financialServices.bookings.some(other=>other.goalId===goal.id&&other.merchantId===b.merchantId&&other.status==='confirmed'))),critical=issues.length>0,label=critical?'旅行订单需要处理，请查询原单或核对退款。':p.taskComplete?'模拟目标的资金与履约证据均已核对。':p.paid?'预订已确认，履约证据仍待核对。':'目标资金或必要检查仍在准备。';
 const id=`goal-notice:${goal.id}:${stableHash({p,issues:issues.map(i=>({id:i.id,status:i.status}))}).slice(0,20)}`;for(const n of s.financialServices.goalNotices.filter(n=>n.goalId===goal.id&&n.id!==id&&n.status==='pending')){n.status='cancelled';changed=true;}if(!s.financialServices.goalNotices.some(n=>n.id===id)){s.financialServices.goalNotices.push({id,goalId:goal.id,label,critical,status:'pending',createdOn:s.clock});changed=true;}
 }
 for(const notice of s.financialServices.goalNotices.filter(n=>n.status==='pending')){const mode=s.financialServices.goalNotificationPreferences.find(p=>p.goalId===notice.goalId)?.mode??'critical';if(mode==='muted'||mode==='critical'&&!notice.critical||s.riskPreferences.pausedUntil&&s.riskPreferences.pausedUntil>=s.clock||notificationDelivery(s.riskPreferences,'immediate',now).mode==='deferred')continue;notice.status='delivered';changed=true;}
 return changed?appendAuditEvent(s,'goal_notice_queue','updated','目标提醒遵守静默与偏好，仅存本地收件箱，不联系外部。'):input;
}
