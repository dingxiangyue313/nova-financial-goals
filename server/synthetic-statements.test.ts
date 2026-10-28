import test from 'node:test';import assert from 'node:assert/strict';
import { syntheticStatements } from './synthetic-statements.ts';import { createJapanMoneyMissionFixture } from './money-mission-fixture.ts';
import { previewStatementImport, commitStatementImport } from './statement-import.ts';import { buildBillBrief } from './bill-analysis.ts';
test('six thousand deterministic history rows commit without overwriting authoritative balances',()=>{
  let total=0;
  for(const profile of ['travel','flex','longterm'] as const){const parsed=syntheticStatements(profile,'2026-10-26');assert.deepEqual(parsed,syntheticStatements(profile,'2026-10-26'));total+=parsed.rows.length;
    const preview=previewStatementImport(createJapanMoneyMissionFixture(),parsed),state=commitStatementImport(preview.state,preview.batch.id,preview.state.twinVersion,preview.contentHash);
    assert.equal(state.finance.checkingCents,724000);assert.equal(state.goal.savedCents,200000);
    const annual=buildBillBrief(state,{periodStart:'2025-01-01',periodEnd:'2025-12-31'});assert.ok(annual.totalExpenseCents>0);assert.ok(annual.claims.every(c=>c.sourceRefs.length>0));
  }assert.equal(total,6000);
});
