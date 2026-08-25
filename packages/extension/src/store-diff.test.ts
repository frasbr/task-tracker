import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { changedIds } from './store-diff.ts';

const at = (entries: [string, string][]) => new Map(entries);

describe('changedIds', () => {
  it('finds nothing when the two snapshots match', () => {
    const previous = at([['tt-1', '2026-08-19T10:00:00.000Z']]);
    const current = at([['tt-1', '2026-08-19T10:00:00.000Z']]);
    assert.deepEqual(changedIds(previous, current), []);
  });

  it('reports an id whose updated timestamp moved', () => {
    const previous = at([['tt-1', '2026-08-19T10:00:00.000Z']]);
    const current = at([['tt-1', '2026-08-19T11:00:00.000Z']]);
    assert.deepEqual(changedIds(previous, current), ['tt-1']);
  });

  it('ignores an id whose timestamp did not move, even when others did', () => {
    const previous = at([
      ['tt-1', '2026-08-19T10:00:00.000Z'],
      ['tt-2', '2026-08-19T10:00:00.000Z'],
    ]);
    const current = at([
      ['tt-1', '2026-08-19T10:00:00.000Z'],
      ['tt-2', '2026-08-19T12:00:00.000Z'],
    ]);
    assert.deepEqual(changedIds(previous, current), ['tt-2']);
  });

  it('reports a newly created id', () => {
    const previous = at([]);
    const current = at([['tt-1', '2026-08-19T10:00:00.000Z']]);
    assert.deepEqual(changedIds(previous, current), ['tt-1']);
  });

  it('reports a removed id', () => {
    const previous = at([['tt-1', '2026-08-19T10:00:00.000Z']]);
    const current = at([]);
    assert.deepEqual(changedIds(previous, current), ['tt-1']);
  });

  it('handles an empty previous snapshot', () => {
    assert.deepEqual(changedIds(at([]), at([])), []);
  });
});
