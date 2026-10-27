import test from 'node:test';
import assert from 'node:assert/strict';
import {recordProductEvent} from './product-events.ts';
import {randomUUID} from 'node:crypto';
test('product events reject raw text, rows, account identifiers, files and tokens',()=>{
  const session=randomUUID();
  assert.ok(recordProductEvent(session,'import_review_completed',{stage:'data',outcome:'succeeded',sourceCount:3,durationBucket:'under_1m'}).id);
  for(const secret of ['rawDescription','merchant','transactions','accountId','fileName','fileBytes','token'])assert.throws(()=>recordProductEvent(session,'import_review_completed',{[secret]:'PRIVATE_VALUE'}));
  assert.throws(()=>recordProductEvent(session,'unknown_event',{}));
  assert.throws(()=>recordProductEvent(session,'bill_evidence_opened',{errorCode:'PRIVATE_ACCOUNT_123456'}));
});
