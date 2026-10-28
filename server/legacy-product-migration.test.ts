import test from 'node:test';import assert from 'node:assert/strict';
import {migrateLegacyProduct} from './legacy-product-migration.ts';
import {createJapanMoneyMissionFixture} from './money-mission-fixture.ts';
import {DemoStateSchema} from '../shared/contracts.ts';
import {snapshot} from './presentation.ts';

test('legacy prototype migration preserves cash and raw evidence while retiring incompatible authority',()=>{
  const base=createJapanMoneyMissionFixture();
  const legacy={...base,accountSnapshots:base.accountSnapshots.map(({sourceKind:_k,sourceId:_i,createdAt:_t,...s})=>({...s,source:'simulated_connection',confirmed:true})),
    normalizedStatementRows:[{id:'old-row',batchId:'old-batch',accountId:'checking',sourceKind:'bank',date:base.clock,title:'Cafe',merchantId:'cafe',category:'dining',amountCents:-1000,currency:'CNY',confidence:1,excludedReason:null}],
    statementImportBatches:[{id:'old-batch',templateId:'nova-synthetic-v1',format:'csv',status:'committed',coverageStart:base.clock,coverageEnd:base.clock,recordCount:1,issueIds:[],createdAt:base.clock+'T12:00:00+08:00',committedAt:base.clock+'T12:00:00+08:00'}],
    transferSchedules:[{id:'old-authority',status:'active',amountCents:100000}],transferExecutions:[{id:'old-receipt',status:'succeeded'}]};
  const original=structuredClone(legacy),migrated=DemoStateSchema.parse(migrateLegacyProduct(legacy));
  assert.deepEqual(legacy,original);assert.deepEqual(migrated.accounts,base.accounts);assert.deepEqual(migrated.finance,base.finance);assert.deepEqual(migrated.goal,base.goal);assert.deepEqual(migrated.audit,base.audit);
  assert.equal(migrated.normalizedStatementRows[0].amountCents,-1000);assert.equal(migrated.statementImportBatches[0].importedCount,1);
  assert.deepEqual(migrated.transferSchedules,[]);assert.deepEqual(migrated.legacyProductArtifacts.transferSchedules,legacy.transferSchedules);
  assert.deepEqual(migrated.legacyProductArtifacts.transferExecutions,legacy.transferExecutions);
  assert.equal(migrated.twinVersion,base.twinVersion+1);
  assert.deepEqual(migrateLegacyProduct(migrated),migrated);
  assert.ok(!('legacyProductArtifacts' in snapshot(migrated)));
});
