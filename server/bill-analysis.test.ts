import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBillBrief, inspectEvidence } from './bill-analysis.ts';
import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';

test('bill facts reproduce the screenshot with source-linked claims and uncertainty', () => {
  const state = createJapanMoneyMissionFixture(); const brief = buildBillBrief(state, { periodStart: '2026-10-01', periodEnd: '2026-10-26' });
  assert.equal(brief.totalExpenseCents, 477800);
  assert.equal(brief.changes.find(c => c.category === 'dining_delivery')!.increaseCents, 31000);
  assert.equal(brief.subscriptionCandidates[0].merchantId, 'cloudbox-plus');
  assert.equal(brief.subscriptionCandidates[0].monthlyCents, 6800);
  assert.ok(brief.claims.every(c => c.sourceRefs!.length > 0));
  assert.match(brief.subscriptionCandidates[0].wording, /可能/);
  assert.equal(inspectEvidence(state, `evidence:${state.normalizedStatementRows[0].id}`).transactionIds.length, 1);
  assert.throws(() => inspectEvidence(state, 'foreign-id'), /EVIDENCE_NOT_FOUND/);
});
test('missing baseline months are disclosed rather than replaced with invented averages', () => {
  const state = createJapanMoneyMissionFixture(); state.normalizedStatementRows = state.normalizedStatementRows.filter(r => !r.date.startsWith('2026-06'));
  const brief = buildBillBrief(state, { periodStart: '2026-10-01', periodEnd: '2026-10-26' });
  assert.equal(brief.changes.length, 0); assert.ok(brief.limitations.some(l => l.includes('基线')));
  assert.equal(buildBillBrief(state, { periodStart: '2026-01-01', periodEnd: '2026-12-31' }).dataAsOf, '2026-10-26');
});
