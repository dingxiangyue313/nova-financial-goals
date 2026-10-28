import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,executeServiceAction,reconcileServices,validateServiceBalances} from './financial-services.ts';
import {serviceIssues,serviceCasePack} from './service-monitor.ts';
import {DemoStateSchema,HandoffCasePackSchema} from '../shared/contracts.ts';

test('material issue IDs survive serialization, cases are read-only and resolved operations leave the inbox',()=>{
 const base=initializeServices(createJapanMoneyMissionFixture());base.financialServices.fault='timeout_after';
 const state=executeServiceAction(base,{kind:'transfer',recipientId:'contact-1',recipientVersion:1,accountId:'checking',amountCents:10000},'uncertain');
 const before=structuredClone(state),issues=serviceIssues(state);assert.equal(issues.length,1);
 assert.deepEqual(serviceIssues(DemoStateSchema.parse(JSON.parse(JSON.stringify(state)))),issues);
 const pack=serviceCasePack(state,issues[0].id);assert.ok(HandoffCasePackSchema.safeParse(pack).success);assert.ok(pack.facts.some(f=>f.label.includes('100.00')));
 assert.equal(pack.attemptedActions[0].outcome,'unknown');assert.deepEqual(state,before);
 assert.throws(()=>serviceCasePack(base,issues[0].id),/ISSUE_NOT_FOUND/);
 const resolved=reconcileServices(state,'uncertain');validateServiceBalances(state,resolved);assert.equal(serviceIssues(resolved).length,0);
 assert.equal(resolved.finance.checkingCents,state.finance.checkingCents-10000);
});
test('case exports omit contact data, tokens, approvals and provider credentials',()=>{
 const base=initializeServices(createJapanMoneyMissionFixture());base.financialServices.fault='decline';
 const state=executeServiceAction(base,{kind:'transfer',recipientId:'contact-1',recipientVersion:1,accountId:'checking',amountCents:10000},'failed');
 const pack=JSON.stringify(serviceCasePack(state,serviceIssues(state)[0].id));
 for(const recipient of state.financialServices.recipients.filter(r=>r.phone))assert.ok(!pack.includes(recipient.phone));
 assert.ok(!pack.includes('approvalToken'));assert.ok(!pack.includes('signature'));assert.ok(!pack.includes('DEEPSEEK'));
});
test('lost cards, overdue obligations and pending investment settlement have explicit recovery steps',()=>{
 let state=initializeServices(createJapanMoneyMissionFixture());
 state=executeServiceAction(state,{kind:'card',id:'card-travel',action:'lost'},'lost');
 state=executeServiceAction(state,{kind:'split',totalCents:10000,participantIds:['self','contact-1'],payerId:'contact-1',accountId:'checking',alreadyPaid:true,dueDate:state.clock},'split');
 state=executeServiceAction(state,{kind:'risk_profile',level:2,tolerateLoss:true,useByDate:'2027-06-30'},'risk');
 state=executeServiceAction(state,{kind:'buy',productId:'liquid',accountId:'checking',amountCents:10000},'investment');
 state={...state,clock:'2026-10-28'};
 const before=structuredClone(state),issues=serviceIssues(state);
 assert.deepEqual(issues.map(i=>i.domain).sort(),['card','investment','split']);
 for(const issue of issues){const pack=serviceCasePack(state,issue.id);assert.ok(pack.questions.length>=3);assert.ok(pack.facts.every(f=>f.sourceRefs.length>0));}
 assert.deepEqual(state,before);
});
