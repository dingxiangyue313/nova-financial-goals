import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionFixture, sampleRows, forecastMission, prepareMission, confirmMission, importSample, reconcileSubscription, tickMission } from './mission.ts';
import { DemoStateSchema } from '../shared/contracts.ts';
import { verifyAuditChain } from './governance.ts';

test('six months of evidence reproduce screenshot, preserve authoritative balances and deduplicate', () => {
  const s = DemoStateSchema.parse(createMissionFixture());
  assert.equal(s.mission!.rows.length, 186);
  assert.equal(-s.mission!.rows.filter(r => r.date.startsWith('2026-10') && !r.excluded && r.cents < 0).reduce((a, r) => a + r.cents, 0), 477800);
  const imported = importSample(s, [...sampleRows(), { ...sampleRows()[0], id: 'fake-balance', cents: 999999999 }], 'test');
  assert.equal(imported.finance.checkingCents, 724000); assert.equal(imported.goal.savedCents, 200000);
  assert.equal(imported.mission!.rows.length, 187);
  assert.deepEqual(importSample(imported, sampleRows(), 'repeated'), imported);
});
test('only verified cancellation suppresses renewal and increases cashflow by 68 yuan', () => {
  const s = createMissionFixture(); assert.equal(forecastMission(s).lowCents, 317200);
  const p = prepareMission(s, 'cancel_subscription');
  const done = confirmMission(p, p.mission!.pending!.id);
  assert.equal(done.mission!.subscription.nextChargeSuppressed, true);
  assert.equal(forecastMission(done).lowCents, 324000);
  assert.equal(done.mission!.subscription.paidThrough, '2026-11-04');
  assert.deepEqual(confirmMission(done, p.mission!.pending!.id), done);
  assert.ok(verifyAuditChain(done.audit));
  for (const outcome of ['unknown', 'failed'] as const) {
    const result = confirmMission(p, p.mission!.pending!.id, outcome);
    assert.equal(forecastMission(result).lowCents, 317200);
    assert.equal(result.mission!.subscription.nextChargeSuppressed, false);
    if (outcome === 'unknown') {
      assert.throws(() => prepareMission(result, 'cancel_subscription'), /RECONCILE/);
      assert.equal(reconcileSubscription(result).mission!.subscription.status, 'active');
    }
  }
});
test('approval binds exact parameters and expires; monthly creation never moves money', () => {
  const s = prepareMission(createMissionFixture(), 'create_schedule'); const id = s.mission!.pending!.id;
  assert.throws(() => confirmMission(createMissionFixture(), id), /APPROVAL_NOT_FOUND/);
  assert.throws(() => confirmMission({ ...s, twinVersion: s.twinVersion + 1 }, id), /TWIN/);
  assert.throws(() => confirmMission({ ...s, mission: { ...s.mission!, pending: { ...s.mission!.pending!, expiresAt: 0 } } }, id), /EXPIRED/);
  const done = confirmMission(s, id); assert.equal(done.finance.checkingCents, 724000); assert.equal(done.goal.savedCents, 200000);
  const pause = prepareMission(done, 'pause_schedule', 75000);
  assert.equal(pause.mission!.pending!.amountCents, 100000, 'preview must retain the actual authorized amount');
  const cancellation = prepareMission(done, 'cancel_schedule');
  const cancelled = confirmMission(cancellation, cancellation.mission!.pending!.id);
  assert.throws(() => prepareMission(cancelled, 'resume_schedule'), /NOT_ACTIVE/);
  assert.throws(() => prepareMission(done, 'create_schedule'), /ALREADY/);
  assert.throws(() => prepareMission(createMissionFixture(), 'create_schedule', 9999999), /INVALID/);
});
test('once transfer changes both account snapshots, preserves protected funds and replays safely', () => {
  const s = prepareMission(createMissionFixture(), 'create_schedule', 120000, 'once');
  const next = confirmMission(s, s.mission!.pending!.id);
  assert.equal(next.goal.savedCents, 320000); assert.equal(next.finance.checkingCents, 604000);
  assert.equal(next.accounts.find(a => a.id === 'goal-wallet')!.balanceCents, 320000);
  assert.equal(next.finance.emergencyCents, 2000000);
  assert.deepEqual(confirmMission(next, s.mission!.pending!.id), next);
});
test('no salary, late salary and stale balance cannot cause an automatic transfer', () => {
  const p = prepareMission(createMissionFixture(), 'create_schedule'); const active = confirmMission(p, p.mission!.pending!.id);
  const noSalary = tickMission(active, '2026-11-28');
  assert.equal(noSalary.finance.checkingCents, 724000); assert.equal(noSalary.mission!.receipts.at(-1)!.status, 'skipped');
  assert.equal(tickMission(noSalary, '2026-11-29').mission!.receipts.length, noSalary.mission!.receipts.length);
  const withSalary = { ...active, mission: { ...active.mission!, rows: [...active.mission!.rows, { id: 'salary-nov', date: '2026-11-25', merchant: '星河设计 · 工资', cents: 850000, category: '工资' as const, source: '银行卡' as const, excluded: true }] } };
  assert.equal(tickMission(withSalary, '2026-11-26').mission!.receipts.at(-1)!.status, 'skipped');
  const fresh = { ...withSalary, finance: { ...withSalary.finance, updatedAt: '2026-11-26' } };
  const done = tickMission(fresh, '2026-11-26');
  assert.equal(done.goal.savedCents, 300000); assert.equal(done.finance.checkingCents, 624000);
  assert.equal(tickMission({ ...fresh, finance: { ...fresh.finance, updatedAt: '2026-11-28' } }, '2026-11-28').mission!.receipts.at(-1)!.status, 'skipped');
  const switched = { ...fresh, goal: { ...fresh.goal, id: 'other-goal' } };
  assert.equal(tickMission(switched, '2026-11-26').mission!.schedule!.status, 'paused');
});
