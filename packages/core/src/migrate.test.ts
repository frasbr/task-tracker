import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateIds } from './migrate.ts';
import { DEFAULT_STATUSES } from './task.ts';
import type { Task } from './task.ts';

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'created'>): Task {
  return {
    title: 'Untitled',
    notes: '',
    category: '',
    tags: [],
    status: 'backlog',
    rank: 'V',
    updated: overrides.created,
    refs: [],
    blockedBy: [],
    ...overrides,
  };
}

describe('migrateIds', () => {
  it('renumbers legacy ids in created order, not file order', () => {
    const later = task({ id: 't4cygkdpg', created: '2026-08-20T10:00:00.000Z', title: 'Later' });
    const earlier = task({
      id: 't1ep9qf7v',
      created: '2026-08-19T10:00:00.000Z',
      title: 'Earlier',
    });

    const migration = migrateIds([later, earlier], 'demo');

    assert.equal(migration.mapping.get('t1ep9qf7v'), 'demo-1');
    assert.equal(migration.mapping.get('t4cygkdpg'), 'demo-2');
    assert.deepEqual(migration.config, {
      prefix: 'demo',
      nextId: 3,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('rewrites cross-references in both title and notes', () => {
    const a = task({ id: 't1ep9qf7v', created: '2026-08-19T10:00:00.000Z' });
    const b = task({
      id: 't4cygkdpg',
      created: '2026-08-20T10:00:00.000Z',
      title: 'Follows on from t1ep9qf7v',
      notes: 'Blocked on t1ep9qf7v until it lands.',
    });

    const migration = migrateIds([a, b], 'demo');
    const migratedB = migration.tasks.find((t) => t.id === 'demo-2')!;

    assert.equal(migratedB.title, 'Follows on from demo-1');
    assert.equal(migratedB.notes, 'Blocked on demo-1 until it lands.');
  });

  it('leaves an already-qualified id untouched and does not consume a number for it', () => {
    const migrated = task({ id: 'demo-4', created: '2026-08-19T10:00:00.000Z' });
    const migration = migrateIds([migrated], 'demo');

    assert.equal(migration.mapping.size, 0);
    assert.equal(migration.tasks[0]!.id, 'demo-4');
    assert.equal(migration.config.nextId, 5, 'the counter picks up after the highest id in use');
  });

  it('numbers past the highest id already using the target prefix', () => {
    const already = task({ id: 'demo-9', created: '2026-08-18T10:00:00.000Z' });
    const legacy = task({ id: 't1ep9qf7v', created: '2026-08-19T10:00:00.000Z' });

    const migration = migrateIds([already, legacy], 'demo');

    assert.equal(migration.mapping.get('t1ep9qf7v'), 'demo-10');
    assert.equal(migration.config.nextId, 11);
  });

  it('is a no-op on a store with nothing left to migrate', () => {
    const already = task({ id: 'demo-1', created: '2026-08-19T10:00:00.000Z' });
    const migration = migrateIds([already], 'demo');

    assert.equal(migration.mapping.size, 0);
    assert.deepEqual(migration.tasks, [already]);
  });

  it('rejects a prefix with a digit-only segment', () => {
    assert.throws(() => migrateIds([], 'foo-2'));
  });
});
