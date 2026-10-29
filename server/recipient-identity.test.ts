import test from 'node:test';
import assert from 'node:assert/strict';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {initializeServices,describeServiceAction,executeServiceAction,reconcileServices} from './financial-services.ts';
import {recipientReady} from '../shared/recipient-identity.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
const base=()=>initializeServices(createJapanMoneyMissionFixture());
const transfer={kind:'transfer',recipientId:'contact-4',recipientVersion:1,accountId:'checking',amountCents:1000} as const;
const verify={kind:'verify_recipient',id:'contact-4',expectedVersion:1,suffix:'1004',acknowledged:true} as const;
test('unreviewed homonym needs exact synthetic suffix confirmation; verification never transfers money',()=>{
 const initial=base();assert.equal(initial.financialServices.recipients.find(r=>r.id==='contact-1')!.name,initial.financialServices.recipients.find(r=>r.id==='contact-4')!.name);
 assert.throws(()=>describeServiceAction(initial,transfer),/RECIPIENT_REVIEW_REQUIRED/);assert.throws(()=>describeServiceAction(initial,{...verify,suffix:'1001'}),/SUFFIX_MISMATCH/);
 const next=executeServiceAction(initial,verify,'verify');assert.deepEqual(next.accounts,initial.accounts);assert.deepEqual(next.finance,initial.finance);assert.equal(next.financialServices.holds.length,0);
 assert.equal(next.financialServices.recipients.find(r=>r.id==='contact-4')!.version,2);assert.ok(recipientReady(next.financialServices.recipients.find(r=>r.id==='contact-4')!));
 assert.equal(executeServiceAction(next,verify,'verify'),next);assert.throws(()=>describeServiceAction(next,transfer),/RECIPIENT_CHANGED/);assert.doesNotThrow(()=>describeServiceAction(next,{...transfer,recipientVersion:2}));assert.ok(DemoStateSchema.safeParse(next).success);
});
test('AA and payer settlement require current recipient verification; legacy and changed versions fail closed',()=>{
 const initial=base();const split={kind:'split',totalCents:39801,participantIds:['self','contact-4'],accountId:'checking',alreadyPaid:true,payerId:'contact-4',dueDate:'2026-12-01'} as const;
 assert.throws(()=>describeServiceAction(initial,split),/RECIPIENT_REVIEW_REQUIRED/);
 let state=executeServiceAction(initial,verify,'verify');state=executeServiceAction(state,split,'split');
 const reviewed=executeServiceAction(state,{kind:'review_recipient',id:'contact-4',expectedVersion:2},'review');assert.throws(()=>describeServiceAction(reviewed,{kind:'pay_split_share',id:'split',accountId:'checking'}),/RECIPIENT_REVIEW_REQUIRED/);
 const legacy=base(),r=legacy.financialServices.recipients.find(r=>r.id==='contact-1')!;delete r.identityStatus;delete r.verifiedVersion;assert.equal(recipientReady(r),false);
 r.identityStatus='verified';r.verifiedVersion=1;r.version=2;assert.equal(recipientReady(r),false);assert.throws(()=>describeServiceAction(legacy,{...transfer,recipientId:r.id,recipientVersion:2}),/RECIPIENT_REVIEW_REQUIRED/);
 assert.deepEqual(reviewed.accounts,state.accounts);
});
test('re-review prevents new payment but never replays or discards an unknown original payment',()=>{
 let state=executeServiceAction(base(),verify,'verify');state.financialServices.fault='timeout_after';state=executeServiceAction(state,{...transfer,recipientVersion:2},'pay');
 state=executeServiceAction(state,{kind:'review_recipient',id:'contact-4',expectedVersion:2},'review');const before=state.accounts.find(a=>a.id==='checking')!.balanceCents;
 const resolved=reconcileServices(state,'pay');assert.equal(resolved.accounts.find(a=>a.id==='checking')!.balanceCents,before-1000);assert.equal(reconcileServices(resolved,'pay'),resolved);
});
