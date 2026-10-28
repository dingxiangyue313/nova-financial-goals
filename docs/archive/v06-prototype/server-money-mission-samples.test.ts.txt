import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImportIssueSchema, NormalizedStatementRowSchema, StatementImportBatchSchema } from '../shared/contracts.ts';

const directory = join(process.cwd(), 'evals', 'money-mission-samples');
const read = (name: string) => JSON.parse(readFileSync(join(directory, name), 'utf8')) as Record<string, unknown>;

test('frozen Money Mission API samples stay schema-valid and use stable error codes', () => {
  const imported = read('sample-import-success.json');
  StatementImportBatchSchema.parse(imported.batch);
  assert.equal((imported.batch as { status: string }).status, 'committed');
  for (const row of imported.rows as unknown[]) NormalizedStatementRowSchema.omit({ rawDescription: true }).parse(row);
  assert.equal(JSON.stringify(imported).includes('rawDescription'), false);

  const issues = read('import-issues-success.json');
  StatementImportBatchSchema.parse(issues.batch);
  assert.equal((issues.batch as { status: string }).status, 'needs_review');
  for (const issue of issues.issues as unknown[]) ImportIssueSchema.parse(issue);

  const snapshot = read('account-snapshot-success.json');
  assert.equal((snapshot.input as { accountId: string }).accountId, 'checking');
  assert.equal((snapshot.input as { balanceCents: number }).balanceCents, 724000);

  const forecast = read('forecast-success.json');
  assert.equal(forecast.precision, 'exact');
  assert.equal(forecast.minimumBalanceCents, 317200);
  const plans = read('goal-plans-success.json').plans as Array<{ projectedDate: string }>;
  assert.deepEqual(plans.map(item => item.projectedDate), ['2027-06-26', '2027-04-26', '2027-02-26']);

  for (const name of ['upload-disabled.json', 'blocking-issues.json', 'twin-expired.json']) {
    const payload = read(name);
    assert.equal(typeof payload.error, 'string');
    assert.equal(payload.code, payload.error);
  }
});
