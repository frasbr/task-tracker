import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BoardTask } from '../protocol.ts';
import { filterTasks, sortColumn } from './board-view.ts';

function task(overrides: Partial<BoardTask>): BoardTask {
  return {
    id: 'tt-1',
    title: 'A task',
    notes: '',
    category: '',
    tags: [],
    status: 'backlog',
    rank: 'm',
    created: '2026-08-01T00:00:00.000Z',
    updated: '2026-08-01T00:00:00.000Z',
    refs: [],
    ...overrides,
  };
}

describe('filterTasks', () => {
  const tasks = [
    task({ id: 'tt-1', category: 'auth', tags: ['bug', 'frontend'] }),
    task({ id: 'tt-2', category: 'api', tags: ['infra'] }),
    task({ id: 'tt-3', category: 'auth', tags: ['infra'] }),
  ];

  it('returns everything when both filters are empty', () => {
    assert.equal(filterTasks(tasks, { category: '', tag: '' }).length, 3);
  });

  it('narrows to one category', () => {
    const result = filterTasks(tasks, { category: 'auth', tag: '' });
    assert.deepEqual(
      result.map((t) => t.id),
      ['tt-1', 'tt-3'],
    );
  });

  it('narrows to one tag', () => {
    const result = filterTasks(tasks, { category: '', tag: 'infra' });
    assert.deepEqual(
      result.map((t) => t.id),
      ['tt-2', 'tt-3'],
    );
  });

  it('applies category and tag together', () => {
    const result = filterTasks(tasks, { category: 'auth', tag: 'infra' });
    assert.deepEqual(
      result.map((t) => t.id),
      ['tt-3'],
    );
  });
});

describe('sortColumn', () => {
  const a = task({
    id: 'a',
    rank: 'a',
    created: '2026-08-01T00:00:00.000Z',
    updated: '2026-08-03T00:00:00.000Z',
  });
  const b = task({
    id: 'b',
    rank: 'b',
    created: '2026-08-02T00:00:00.000Z',
    updated: '2026-08-01T00:00:00.000Z',
  });
  const c = task({
    id: 'c',
    rank: 'c',
    created: '2026-08-03T00:00:00.000Z',
    updated: '2026-08-02T00:00:00.000Z',
  });
  const unordered = [c, a, b];

  it('rank is the manual order, ascending', () => {
    assert.deepEqual(
      sortColumn(unordered, 'rank').map((t) => t.id),
      ['a', 'b', 'c'],
    );
  });

  it('updated is most-recently-updated first', () => {
    assert.deepEqual(
      sortColumn(unordered, 'updated').map((t) => t.id),
      ['a', 'c', 'b'],
    );
  });

  it('created is oldest first', () => {
    assert.deepEqual(
      sortColumn(unordered, 'created').map((t) => t.id),
      ['a', 'b', 'c'],
    );
  });

  it('does not mutate its input', () => {
    const input = [c, a, b];
    sortColumn(input, 'rank');
    assert.deepEqual(
      input.map((t) => t.id),
      ['c', 'a', 'b'],
    );
  });
});
