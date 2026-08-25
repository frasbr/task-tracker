import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropPosition } from './drop-position.ts';

void test('dropPosition', async (t) => {
  await t.test('an empty column sends neither flag, which appends', () => {
    assert.deepEqual(dropPosition([], 0), {});
  });

  await t.test('dropped above the first card sends only --before', () => {
    assert.deepEqual(dropPosition(['a', 'b', 'c'], 0), { before: 'a' });
  });

  await t.test('a negative index clamps to the top, same as 0', () => {
    assert.deepEqual(dropPosition(['a', 'b', 'c'], -1), { before: 'a' });
  });

  await t.test('dropped below the last card sends only --after', () => {
    assert.deepEqual(dropPosition(['a', 'b', 'c'], 3), { after: 'c' });
  });

  await t.test('an index past the end clamps to the bottom, same as length', () => {
    assert.deepEqual(dropPosition(['a', 'b', 'c'], 99), { after: 'c' });
  });

  await t.test('an interior drop sends --before the card it displaces', () => {
    assert.deepEqual(dropPosition(['a', 'b', 'c'], 1), { before: 'b' });
    assert.deepEqual(dropPosition(['a', 'b', 'c'], 2), { before: 'c' });
  });

  await t.test('a single-card column can still receive before or after', () => {
    assert.deepEqual(dropPosition(['a'], 0), { before: 'a' });
    assert.deepEqual(dropPosition(['a'], 1), { after: 'a' });
  });

  await t.test('never sends both flags at once', () => {
    for (const idx of [-1, 0, 1, 2, 3, 99]) {
      const position = dropPosition(['a', 'b', 'c'], idx);
      assert.ok(position.before === undefined || position.after === undefined);
    }
  });
});
