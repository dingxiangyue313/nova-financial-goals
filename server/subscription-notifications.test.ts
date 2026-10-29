import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoStateSchema} from '../shared/contracts.ts';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {prepareSubscriptionAction,persistSubscriptionDecision} from './subscription-service.ts';
import {tickSubscriptionNotifications,decideSubscriptionNotification} from './subscription-notifications.ts';
function fixture(){let state=createJapanMoneyMissionFixture();const action=prepareSubscriptionAction(state,{subscriptionId:'cloudbox-plus',action:'remind'}).action;state=persistSubscriptionDecision(state,action);return {...state,clock:'2026-11-04'};}
const noon=new Date('2026-11-04T04:00:00Z');
test('persistent queue delivers once and survives serialization without changing funds, authority or financial version',()=>{
 const base=fixture(),first=tickSubscriptionNotifications(base,noon),item=first.financialServices.subscriptionNotifications[0];
 assert.equal(item.status,'delivered');assert.equal(item.deliveredAt,noon.toISOString());
 const restored=DemoStateSchema.parse(JSON.parse(JSON.stringify(first)));assert.equal(tickSubscriptionNotifications(restored,noon),restored);
 assert.equal(first.twinVersion,base.twinVersion);assert.deepEqual(first.finance,base.finance);assert.deepEqual(first.accounts,base.accounts);assert.deepEqual(first.approvals,base.approvals);assert.deepEqual(first.subscriptionMerchants,base.subscriptionMerchants);
});
test('quiet hours, paused notifications and later dates defer delivery without discarding the reminder',()=>{
 const state=fixture();state.riskPreferences.quietHours={start:'22:00',end:'07:00'};
 let pending=tickSubscriptionNotifications(state,new Date('2026-11-04T15:00:00Z'));assert.equal(pending.financialServices.subscriptionNotifications[0].status,'pending');
 pending=tickSubscriptionNotifications(pending,noon);assert.equal(pending.financialServices.subscriptionNotifications[0].status,'delivered');
 const paused=fixture();paused.riskPreferences.pausedUntil='2026-11-04';assert.equal(tickSubscriptionNotifications(paused,noon).financialServices.subscriptionNotifications[0].status,'pending');
 const early={...fixture(),clock:'2026-11-03'};assert.equal(tickSubscriptionNotifications(early,noon).financialServices.subscriptionNotifications[0].status,'pending');
});
test('snooze and read are replay-safe local choices; replacing subscription choice retires old reminders',()=>{
 const first=tickSubscriptionNotifications(fixture(),noon),id=first.financialServices.subscriptionNotifications[0].id;
 const snoozed=decideSubscriptionNotification(first,id,'snooze','2026-11-05',noon);assert.equal(tickSubscriptionNotifications(snoozed,noon),snoozed);
 const tomorrow={...snoozed,clock:'2026-11-05'};assert.equal(tickSubscriptionNotifications(tomorrow,new Date('2026-11-05T04:00:00Z')).financialServices.subscriptionNotifications[0].status,'delivered');
 const read=decideSubscriptionNotification(first,id,'read',undefined,noon);assert.equal(decideSubscriptionNotification(read,id,'read',undefined,noon),read);assert.equal(tickSubscriptionNotifications(read,noon),read);
 assert.throws(()=>decideSubscriptionNotification(first,id,'snooze','2026-11-04',noon),/INVALID_DATE/);
 assert.throws(()=>decideSubscriptionNotification(first,'foreign','read'),/NOT_FOUND/);
 const keep=prepareSubscriptionAction(first,{subscriptionId:'cloudbox-plus',action:'keep'}).action;
 const cancelled=tickSubscriptionNotifications(persistSubscriptionDecision(first,keep),noon);assert.equal(cancelled.financialServices.subscriptionNotifications[0].status,'cancelled');
});
