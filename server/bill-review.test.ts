import test from 'node:test';
import assert from 'node:assert/strict';
import {consumerFixture} from './product-mission.ts';
import {billInvestigation,reviewBillChange} from './bill-review.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
const period={periodStart:'2026-10-01',periodEnd:'2026-10-26'};
test('feedback is scoped to exact evidence, persists, is idempotent and never changes amounts',async()=>{
 const initial=await consumerFixture(),before=structuredClone(initial),items=billInvestigation(initial,period).items;
 assert.deepEqual(initial,before);assert.ok(items.length);const item=items[0];assert.ok(item.sourceRefs.length);assert.ok(item.baselineStart!<period.periodStart);
 const body={...period,fingerprint:item.fingerprint,decision:'expected',expectedTwinVersion:initial.twinVersion};
 const next=reviewBillChange(initial,body);assert.equal(billInvestigation(next,period).items[0].review?.decision,'expected');assert.equal(billInvestigation(initial,period).items[0].review,null);
 assert.deepEqual(next.accounts,initial.accounts);assert.deepEqual(next.finance,initial.finance);assert.deepEqual(next.normalizedStatementRows,initial.normalizedStatementRows);assert.ok(DemoStateSchema.safeParse(next).success);
 assert.equal(reviewBillChange(next,{...body,expectedTwinVersion:next.twinVersion}),next);assert.throws(()=>reviewBillChange(next,body),/TWIN_VERSION_CHANGED/);
 const unrelated=structuredClone(next);unrelated.twinVersion++;assert.equal(billInvestigation(unrelated,period).items[0].review?.decision,'expected');
});
test('changed evidence invalidates old feedback without erasing audit or suppressing facts',async()=>{
 const initial=await consumerFixture();const item=billInvestigation(initial,period).items.find(i=>i.category==='subscriptions')!;
 const next=reviewBillChange(initial,{...period,fingerprint:item.fingerprint,decision:'unrecognized',expectedTwinVersion:initial.twinVersion});
 const row=next.normalizedStatementRows.find(r=>item.sourceRefs.includes(`evidence-${r.id}`)&&r.date>=period.periodStart)!;row.amountCents-=100;next.twinVersion++;
 const changed=billInvestigation(next,period).items.find(i=>i.category==='subscriptions')!;assert.notEqual(changed.fingerprint,item.fingerprint);assert.equal(changed.review,null);assert.equal(changed.previousReviewCount,1);assert.equal(next.billReviews.length,1);
 assert.throws(()=>reviewBillChange(next,{...period,fingerprint:item.fingerprint,decision:'later',expectedTwinVersion:next.twinVersion}),/BILL_REVIEW_STALE/);
 assert.ok(billInvestigation(next,{periodStart:'2026-09-01',periodEnd:'2026-09-30'}).items.every(i=>i.review===null));
});
