import type {DemoState} from '../shared/contracts.ts';
import {subscriptionReminders} from './subscription-catalog.ts';
import {notificationDelivery} from './risk.ts';
import {appendAuditEvent} from './governance.ts';
/** Atomic persistence by the session store makes each reminder ID deliver at most once. No external messaging. */
export function tickSubscriptionNotifications(state:DemoState,now=new Date()):DemoState{
 const valid=subscriptionReminders(state),queue=structuredClone(state.financialServices.subscriptionNotifications);let changed=false;
 for(const item of valid)if(!queue.some(n=>n.id===item.id)){queue.push({...item,status:'pending',snoozedUntil:null,deliveredAt:null,readAt:null});changed=true;}
 for(const notification of queue){
  if(!valid.some(v=>v.id===notification.id)&&notification.status!=='cancelled'){notification.status='cancelled';changed=true;continue;}
  if(notification.status!=='pending'||notification.dueDate>state.clock||notification.snoozedUntil&&notification.snoozedUntil>state.clock)continue;
  if(state.riskPreferences.pausedUntil&&state.riskPreferences.pausedUntil>=state.clock)continue;
  if(notificationDelivery(state.riskPreferences,'immediate',now).mode==='deferred')continue;
  notification.status='delivered';notification.deliveredAt=now.toISOString();changed=true;
 }
 if(!changed)return state;
 return appendAuditEvent({...state,financialServices:{...state.financialServices,subscriptionNotifications:queue}},'subscription_reminder_queue','updated','已核对本地订阅提醒队列；不联系商户、不取消服务、不改资金。');
}
export function decideSubscriptionNotification(state:DemoState,id:string,action:'read'|'snooze',until?:string,now=new Date()):DemoState{
 const notification=state.financialServices.subscriptionNotifications.find(n=>n.id===id);if(!notification)throw new Error('SUBSCRIPTION_REMINDER_NOT_FOUND');
 if(notification.status==='cancelled')throw new Error('SUBSCRIPTION_REMINDER_EXPIRED');
 if(action==='snooze'&&(!until||until<=state.clock||until>new Date(Date.parse(state.clock+'T00:00:00Z')+30*86400000).toISOString().slice(0,10)))throw new Error('SUBSCRIPTION_REMINDER_INVALID_DATE');
 if(action==='read'&&notification.status==='read')return state;
 const next={...notification,status:action==='read'?'read' as const:'pending' as const,snoozedUntil:action==='snooze'?until!:null,readAt:action==='read'?now.toISOString():null};
 return appendAuditEvent({...state,financialServices:{...state.financialServices,subscriptionNotifications:state.financialServices.subscriptionNotifications.map(n=>n.id===id?next:n)}},'subscription_reminder_choice',action,'用户仅更新本地提醒状态，未执行金融操作。');
}
