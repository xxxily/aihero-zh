import test from 'node:test';
import assert from 'node:assert/strict';
import { diffStrings, coverageFor } from '../src/lib/diff.mjs';

test('detects additions, removals and near-text changes', () => {
  const diff = diffStrings(
    [{ text: 'Old explanation' }, { text: 'Removed' }],
    [{ text: 'New explanation' }, { text: 'Added' }],
  );
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.added[0].text, 'Added');
  assert.equal(diff.removed[0].text, 'Removed');
});

test('calculates review coverage', () => {
  const result = coverageFor({ strings: [{ text: 'Hello' }, { text: '/setup' }, { text: 'World' }] }, { Hello: '你好' });
  assert.deepEqual(result, { total: 2, covered: 1, missing: 1, percentage: 50 });
});
