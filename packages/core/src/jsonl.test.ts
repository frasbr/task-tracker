import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { readConfig, writeConfig } from './config.ts';
import { formatId } from './ids.ts';
import { createJsonlStore, migrateStore } from './jsonl.ts';
import { RANK_LENGTH_LIMIT, isRank } from './rank.ts';
import { DEFAULT_STATUSES } from './task.ts';
import { TaskValidationError } from './validate.ts';
import type { TaskStore } from './store.ts';

let dir: string;
let file: string;
let store: TaskStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'task-tracker-'));
  file = join(dir, 'tasks.jsonl');
  store = createJsonlStore(file);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const draft = (title: string, overrides: Record<string, unknown> = {}) => ({
  title,
  notes: '',
  category: '',
  tags: [],
  status: 'backlog' as const,
  refs: [],
  ...overrides,
});

async function lines(): Promise<string[]> {
  const contents = await readFile(file, 'utf8');
  return contents.split('\n').filter((line) => line !== '');
}

describe('reading', () => {
  it('treats a missing file as an empty store', async () => {
    assert.deepEqual(await store.list(), []);
  });

  it('treats an empty file as an empty store', async () => {
    await writeFile(file, '');
    assert.deepEqual(await store.list(), []);
  });

  it('names the file and line when a line is not JSON', async () => {
    const good = await store.create(draft('Real task'));
    await writeFile(file, `${JSON.stringify(good)}\nnot json at all\n`);
    await assert.rejects(store.list(), (error: unknown) => {
      assert.ok(error instanceof TaskValidationError);
      assert.match(error.message, /tasks\.jsonl:2/);
      assert.match(error.message, /edited by hand/);
      return true;
    });
  });

  it('rejects a file containing an unknown field', async () => {
    const task = await store.create(draft('Real task'));
    await writeFile(file, `${JSON.stringify({ ...task, assignee: 'me' })}\n`);
    await assert.rejects(store.list(), /unknown field 'assignee'/);
  });

  it('rejects duplicate IDs', async () => {
    const task = await store.create(draft('Real task'));
    await writeFile(file, `${JSON.stringify(task)}\n${JSON.stringify(task)}\n`);
    await assert.rejects(store.list(), /duplicate task ID/);
  });
});

describe('round-tripping', () => {
  it('preserves every field, including awkward notes', async () => {
    const notes = 'line one\n\n  indented\ttab\n"quoted" and \\ backslash\nunicode: ✓ ✗';
    const created = await store.create(
      draft('Fix auth redirect loop', {
        notes,
        category: 'auth',
        tags: ['frontend', 'bug'],
        status: 'in-progress',
        refs: ['src/auth.ts:42-58', 'docs/adr/003.md'],
      }),
    );

    const read = await store.get(created.id);
    assert.deepEqual(read, created);
    assert.equal(read?.notes, notes);
  });

  it('writes exactly one line per task', async () => {
    await store.create(draft('One', { notes: 'multi\nline\nnotes' }));
    await store.create(draft('Two'));
    assert.equal((await lines()).length, 2);
  });

  it('writes fields in a fixed order for readable diffs', async () => {
    await store.create(draft('Ordered'));
    const [line] = await lines();
    assert.deepEqual(Object.keys(JSON.parse(line!)), [
      'id',
      'title',
      'notes',
      'category',
      'tags',
      'status',
      'rank',
      'created',
      'updated',
      'refs',
    ]);
  });

  it('returns exactly what it stored, normalised', async () => {
    const created = await store.create(
      draft('Normalising', { tags: ['frontend', 'bug', 'bug'], category: '  auth  ' }),
    );
    assert.deepEqual(created.tags, ['bug', 'frontend'], 'tags are sorted and deduplicated');
    assert.equal(created.category, 'auth', 'category is trimmed');
    assert.deepEqual(await store.get(created.id), created, 'the return value must match the file');
  });

  it('rejects a bad value before it reaches disk', async () => {
    const task = await store.create(draft('Valid'));
    await assert.rejects(store.update(task.id, { title: '   ' }), /cannot be empty/);
    assert.deepEqual(await store.list(), [task], 'the store must be untouched');
  });

  it('leaves no temporary files behind', async () => {
    await store.create(draft('One'));
    await store.create(draft('Two'));
    assert.deepEqual((await readdir(dir)).sort(), ['config.json', 'tasks.jsonl']);
  });
});

describe('creating', () => {
  it('allocates an incremental ID, a rank, and matching timestamps', async () => {
    const task = await store.create(draft('New'));
    assert.match(task.id, /^task-\d+$/);
    assert.ok(isRank(task.rank));
    assert.equal(task.created, task.updated);
  });

  it('never reuses a number, even after the task holding it is removed', async () => {
    const first = await store.create(draft('One'));
    await store.remove(first.id);
    const second = await store.create(draft('Two'));
    assert.notEqual(second.id, first.id);
  });

  it('appends to the end of its own column', async () => {
    const first = await store.create(draft('First'));
    const second = await store.create(draft('Second'));
    const third = await store.create(draft('Third'));
    assert.ok(first.rank < second.rank && second.rank < third.rank);
  });

  it('ranks columns independently', async () => {
    await store.create(draft('Backlog one'));
    const priority = await store.create(draft('Priority one', { status: 'priority' }));
    assert.ok(isRank(priority.rank));
  });
});

describe('updating', () => {
  it('applies the patch, touches updated, and keeps created', async () => {
    const task = await store.create(draft('Before'));
    await new Promise((resolve) => setTimeout(resolve, 2));
    const updated = await store.update(task.id, { title: 'After', tags: ['bug'] });

    assert.equal(updated.title, 'After');
    assert.deepEqual(updated.tags, ['bug']);
    assert.equal(updated.created, task.created);
    assert.notEqual(updated.updated, task.updated);
  });

  it('repositions into the new column when status changes', async () => {
    const existing = await store.create(draft('Already there', { status: 'done' }));
    const moved = await store.update((await store.create(draft('Moving'))).id, { status: 'done' });
    assert.equal(moved.status, 'done');
    assert.ok(moved.rank > existing.rank, 'should land after what is already in the column');
  });

  it('reports an unknown ID with a way to recover', async () => {
    await assert.rejects(store.update('tzzzzzzzz', { title: 'x' }), /tasks list/);
  });
});

describe('moving', () => {
  const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title);

  it('appends to the target column by default', async () => {
    const a = await store.create(draft('A', { status: 'priority' }));
    const b = await store.create(draft('B'));
    await store.move(b.id, 'priority');

    const column = await store.list({ status: 'priority' });
    assert.deepEqual(titles(column), ['A', 'B']);
    assert.equal(column[0]!.id, a.id);
  });

  it('places a task after a named neighbour', async () => {
    const a = await store.create(draft('A', { status: 'priority' }));
    await store.create(draft('B', { status: 'priority' }));
    const c = await store.create(draft('C'));

    await store.move(c.id, 'priority', { after: a.id });
    assert.deepEqual(titles(await store.list({ status: 'priority' })), ['A', 'C', 'B']);
  });

  it('places a task before a named neighbour', async () => {
    const a = await store.create(draft('A', { status: 'priority' }));
    await store.create(draft('B', { status: 'priority' }));
    const c = await store.create(draft('C'));

    await store.move(c.id, 'priority', { before: a.id });
    assert.deepEqual(titles(await store.list({ status: 'priority' })), ['C', 'A', 'B']);
  });

  it('reorders within a column without touching its neighbours', async () => {
    const a = await store.create(draft('A'));
    const b = await store.create(draft('B'));
    const c = await store.create(draft('C'));

    await store.move(c.id, 'backlog', { before: a.id });

    assert.deepEqual(titles(await store.list({ status: 'backlog' })), ['C', 'A', 'B']);
    assert.equal((await store.get(a.id))!.rank, a.rank, 'A must not be renumbered');
    assert.equal((await store.get(b.id))!.rank, b.rank, 'B must not be renumbered');
  });

  it('refuses to position against a task in another column', async () => {
    const elsewhere = await store.create(draft('Elsewhere', { status: 'done' }));
    const moving = await store.create(draft('Moving'));
    await assert.rejects(
      store.move(moving.id, 'priority', { after: elsewhere.id }),
      /not in that column/,
    );
  });

  it('refuses to position a task against itself', async () => {
    const task = await store.create(draft('Self'));
    await assert.rejects(store.move(task.id, 'backlog', { after: task.id }), /itself/);
  });
});

describe('removing', () => {
  it('deletes the task and leaves the rest alone', async () => {
    const a = await store.create(draft('A'));
    const b = await store.create(draft('B'));
    await store.remove(a.id);

    assert.equal(await store.get(a.id), undefined);
    assert.deepEqual(
      (await store.list()).map((task) => task.id),
      [b.id],
    );
  });

  it('reports an unknown ID', async () => {
    await assert.rejects(store.remove('tzzzzzzzz'), /No task with ID/);
  });
});

describe('ordering on disk', () => {
  it('sorts by column, then by rank', async () => {
    await store.create(draft('Done one', { status: 'done' }));
    await store.create(draft('Backlog one'));
    await store.create(draft('Progress one', { status: 'in-progress' }));
    await store.create(draft('Priority one', { status: 'priority' }));

    const stored = (await lines()).map((line) => JSON.parse(line) as { status: string });
    assert.deepEqual(
      stored.map((task) => task.status),
      ['backlog', 'priority', 'in-progress', 'done'],
    );
  });
});

describe('rank exhaustion', () => {
  it('renumbers a column whose keys have grown past the limit', async () => {
    const seed = await store.create(draft('Seed'));
    const long = 'V'.repeat(RANK_LENGTH_LIMIT + 3);
    await writeFile(file, `${JSON.stringify({ ...seed, rank: long })}\n`);

    // Any write triggers the check.
    await store.create(draft('Trigger'));

    const column = await store.list({ status: 'backlog' });
    assert.equal(column.length, 2);
    for (const task of column) {
      assert.ok(task.rank.length <= RANK_LENGTH_LIMIT, `${task.rank} should have been shortened`);
      assert.ok(isRank(task.rank));
    }
    assert.ok(column[0]!.rank < column[1]!.rank, 'renumbering must preserve order');
  });
});

describe('filtering', () => {
  beforeEach(async () => {
    await store.create(draft('Auth bug', { category: 'auth', tags: ['bug'], status: 'priority' }));
    await store.create(draft('Auth docs', { category: 'auth', tags: ['docs'] }));
    await store.create(draft('API bug', { category: 'api', tags: ['bug', 'urgent'] }));
  });

  const titles = async (filter: Parameters<TaskStore['list']>[0]) =>
    (await store.list(filter)).map((task) => task.title).sort();

  it('filters by status', async () => {
    assert.deepEqual(await titles({ status: 'priority' }), ['Auth bug']);
  });

  it('filters by several statuses at once', async () => {
    assert.deepEqual(await titles({ status: ['priority', 'backlog'] }), [
      'API bug',
      'Auth bug',
      'Auth docs',
    ]);
  });

  it('filters by category', async () => {
    assert.deepEqual(await titles({ category: 'auth' }), ['Auth bug', 'Auth docs']);
  });

  it('requires every listed tag', async () => {
    assert.deepEqual(await titles({ tags: ['bug'] }), ['API bug', 'Auth bug']);
    assert.deepEqual(await titles({ tags: ['bug', 'urgent'] }), ['API bug']);
  });

  it('searches title and notes', async () => {
    assert.deepEqual(await titles({ query: 'docs' }), ['Auth docs']);
  });

  it('combines filters', async () => {
    assert.deepEqual(await titles({ category: 'auth', tags: ['bug'] }), ['Auth bug']);
  });
});

describe('project config', () => {
  it('gives a fresh empty store a default prefix and starts counting at 1', async () => {
    const task = await store.create(draft('First'));
    assert.equal(task.id, 'task-1');
    assert.deepEqual(await readConfig(dir), {
      prefix: 'task',
      nextId: 2,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('mints ids from a prefix set before any task existed', async () => {
    await writeConfig(dir, { prefix: 'demo', nextId: 5, statuses: [...DEFAULT_STATUSES] });
    const task = await store.create(draft('First'));
    assert.equal(task.id, 'demo-5');
    assert.deepEqual(await readConfig(dir), {
      prefix: 'demo',
      nextId: 6,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('never reuses a number across the counter, even across store instances', async () => {
    await store.create(draft('One'));
    const second = createJsonlStore(file);
    const task = await second.create(draft('Two'));
    assert.equal(task.id, 'task-2');
  });

  it('refuses to read a non-empty store that predates config.json', async () => {
    const task = await store.create(draft('X'));
    await writeFile(file, `${JSON.stringify({ ...task, id: 't1ep9qf7v' })}\n`);
    await rm(join(dir, 'config.json'));

    await assert.rejects(store.list(), (error: unknown) => {
      assert.ok(error instanceof TaskValidationError);
      assert.match(error.message, /migrate-ids/);
      return true;
    });
  });

  it("rejects a task carrying a different project's prefix", async () => {
    await writeConfig(dir, { prefix: 'demo', nextId: 1, statuses: [...DEFAULT_STATUSES] });
    const task = await store.create(draft('X'));
    await writeFile(file, `${JSON.stringify({ ...task, id: 'other-3' })}\n`);

    await assert.rejects(store.list(), /not a valid task ID/);
  });

  it('validates and orders tasks against a config with custom statuses', async () => {
    await writeConfig(dir, {
      prefix: 'task',
      nextId: 1,
      statuses: ['triage', 'review', 'shipped'],
    });

    const shipped = await store.create(draft('Ship it', { status: 'shipped' }));
    const triaged = await store.create(draft('Look at it', { status: 'triage' }));

    // Column order follows the config, not the four defaults.
    const ids = (await store.list()).map((t) => t.id);
    assert.deepEqual(ids, [triaged.id, shipped.id]);
  });

  it('names the configured statuses when a task carries an unknown one', async () => {
    await writeConfig(dir, { prefix: 'task', nextId: 1, statuses: ['triage', 'shipped'] });
    const task = await store.create(draft('X', { status: 'triage' }));
    await writeFile(file, `${JSON.stringify({ ...task, status: 'backlog' })}\n`);

    await assert.rejects(store.list(), (error: unknown) => {
      assert.ok(error instanceof TaskValidationError);
      assert.match(error.message, /'backlog' is not a status/);
      assert.match(error.message, /triage, shipped/);
      return true;
    });
  });
});

describe('status management', () => {
  it('lists the configured statuses', async () => {
    await store.create(draft('X'));
    assert.deepEqual(await store.listStatuses(), [...DEFAULT_STATUSES]);
  });

  it('adds a status at the end, or after/before a named one', async () => {
    await store.create(draft('X'));
    assert.deepEqual(await store.addStatus('review'), [
      'backlog',
      'priority',
      'in-progress',
      'done',
      'review',
    ]);
    assert.deepEqual(await store.addStatus('triage', { before: 'backlog' }), [
      'triage',
      'backlog',
      'priority',
      'in-progress',
      'done',
      'review',
    ]);
    assert.deepEqual(await store.addStatus('blocked', { after: 'priority' }), [
      'triage',
      'backlog',
      'priority',
      'blocked',
      'in-progress',
      'done',
      'review',
    ]);
  });

  it('refuses a duplicate name and an unknown neighbour', async () => {
    await store.create(draft('X'));
    await assert.rejects(store.addStatus('backlog'), /already exists/);
    await assert.rejects(store.addStatus('review', { after: 'nope' }), /not a status/);
  });

  it('renames a status and rewrites its tasks in the same store', async () => {
    const task = await store.create(draft('X', { status: 'priority' }));
    assert.deepEqual(await store.renameStatus('priority', 'next-up'), [
      'backlog',
      'next-up',
      'in-progress',
      'done',
    ]);
    assert.equal((await store.get(task.id))!.status, 'next-up');
  });

  it('refuses to rename onto an existing status, or from an unknown one', async () => {
    await store.create(draft('X'));
    await assert.rejects(store.renameStatus('priority', 'done'), /more than once/);
    await assert.rejects(store.renameStatus('nope', 'x'), /not a status/);
  });

  it('reorders an existing status', async () => {
    await store.create(draft('X'));
    assert.deepEqual(await store.reorderStatus('done', { before: 'backlog' }), [
      'done',
      'backlog',
      'priority',
      'in-progress',
    ]);
  });

  it('removes an empty status without touching tasks', async () => {
    const task = await store.create(draft('X', { status: 'backlog' }));
    assert.deepEqual(await store.removeStatus('done'), ['backlog', 'priority', 'in-progress']);
    assert.equal((await store.get(task.id))!.status, 'backlog');
  });

  it('refuses to remove a non-empty status without a destination', async () => {
    await store.create(draft('X', { status: 'priority' }));
    await assert.rejects(store.removeStatus('priority'), /still holds 1 task/);
  });

  it('moves a removed status’s tasks to the destination with fresh ranks', async () => {
    const a = await store.create(draft('A', { status: 'priority' }));
    const b = await store.create(draft('B', { status: 'priority' }));
    await store.create(draft('C', { status: 'done' }));

    const statuses = await store.removeStatus('priority', 'done');
    assert.ok(!statuses.includes('priority'));

    const done = (await store.list()).filter((t) => t.status === 'done');
    assert.deepEqual(
      done.map((t) => t.id).sort(),
      [a.id, b.id, done.find((t) => t.title === 'C')!.id].sort(),
    );
    // The moved tasks land after C, in their original order, with no rank collisions.
    const ranks = done.map((t) => t.rank);
    assert.equal(new Set(ranks).size, ranks.length);
  });

  it('refuses to remove the last status', async () => {
    await writeConfig(dir, { prefix: 'task', nextId: 1, statuses: ['only'] });
    await assert.rejects(store.removeStatus('only'), /at least one column/);
  });
});

describe('migrateStore', () => {
  it('renumbers legacy ids in created order and rewrites cross-references', async () => {
    const older = {
      id: 't1ep9qf7v',
      title: 'Older task',
      notes: 'See also t4cygkdpg.',
      category: '',
      tags: [],
      status: 'backlog',
      rank: 'V',
      created: '2026-08-19T10:00:00.000Z',
      updated: '2026-08-19T10:00:00.000Z',
      refs: [],
    };
    const newer = {
      ...older,
      id: 't4cygkdpg',
      title: 'Newer task, references t1ep9qf7v',
      notes: '',
      created: '2026-08-20T10:00:00.000Z',
      updated: '2026-08-20T10:00:00.000Z',
    };
    await writeFile(file, `${JSON.stringify(older)}\n${JSON.stringify(newer)}\n`);

    const migration = await migrateStore(file, 'demo');

    assert.deepEqual(migration.config, {
      prefix: 'demo',
      nextId: 3,
      statuses: [...DEFAULT_STATUSES],
    });
    assert.deepEqual(Object.fromEntries(migration.mapping), {
      t1ep9qf7v: 'demo-1',
      t4cygkdpg: 'demo-2',
    });

    const migrated = createJsonlStore(file);
    const tasks = await migrated.list();
    const byTitle = (title: string) => tasks.find((task) => task.title.startsWith(title))!;

    assert.equal(byTitle('Older').id, 'demo-1');
    assert.equal(byTitle('Older').notes, 'See also demo-2.');
    assert.equal(byTitle('Newer').id, 'demo-2');
    assert.equal(byTitle('Newer').title, 'Newer task, references demo-1');
    assert.deepEqual(await readConfig(dir), {
      prefix: 'demo',
      nextId: 3,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('leaves an already-qualified id untouched and does not consume a number for it', async () => {
    const already = {
      id: formatId('demo', 9),
      title: 'Already migrated',
      notes: '',
      category: '',
      tags: [],
      status: 'backlog',
      rank: 'V',
      created: '2026-08-19T10:00:00.000Z',
      updated: '2026-08-19T10:00:00.000Z',
      refs: [],
    };
    const legacy = { ...already, id: 't1ep9qf7v', title: 'Still legacy' };
    await writeFile(file, `${JSON.stringify(already)}\n${JSON.stringify(legacy)}\n`);

    const migration = await migrateStore(file, 'demo');

    assert.equal(migration.mapping.size, 1);
    assert.equal(
      migration.mapping.get('t1ep9qf7v'),
      'demo-10',
      'picks up after the existing demo-9',
    );
    assert.equal(migration.config.nextId, 11);
  });
});
