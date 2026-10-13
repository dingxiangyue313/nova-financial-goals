import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUiCard } from '../shared/generative.ts';

test('unknown or invalid generative components degrade to a non-action explanation', () => {
  const card = normalizeUiCard({ id: 'evil', type: 'wire_money', action: { id: 'execute', label: '立即转账' } });
  assert.equal(card.type, 'explanation');
  assert.equal(card.action, null);
  assert.match(card.body, /阻止/);
});
