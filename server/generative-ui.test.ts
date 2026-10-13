import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentComponent, normalizeUiCard } from '../shared/generative.ts';

test('unknown or invalid generative components degrade to a non-action explanation', () => {
  const card = normalizeUiCard({ id: 'evil', type: 'wire_money', action: { id: 'execute', label: '立即转账' } });
  assert.equal(card.type, 'explanation');
  assert.equal(card.action, null);
  assert.match(card.body, /阻止/);
});

test('unknown agent components degrade without preserving executable actions', () => {
  const component = normalizeAgentComponent({ id: 'evil', type: 'wire_money',
    action: { actionId: 'steal', label: '立即转账' } });
  assert.equal(component.type, 'explanation');
  assert.equal('action' in component, false);
});
