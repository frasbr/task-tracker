import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Task } from '@task-tracker/core';
import { DEFAULT_STATUSES, readConfig, sanitizePrefix } from '@task-tracker/core';
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, run } from './run.ts';

let project: string;
let skills: string;
let previousSkillsDir: string | undefined;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'task-tracker-cli-'));

  // `tasks init` installs the agent skill into the user's home. Redirect it, or a test
  // run writes into the real ~/.claude/skills — which it did, once, before this existed.
  skills = await mkdtemp(join(tmpdir(), 'task-tracker-cli-skills-'));
  previousSkillsDir = process.env['CLAUDE_SKILLS_DIR'];
  process.env['CLAUDE_SKILLS_DIR'] = skills;
});

afterEach(async () => {
  if (previousSkillsDir === undefined) delete process.env['CLAUDE_SKILLS_DIR'];
  else process.env['CLAUDE_SKILLS_DIR'] = previousSkillsDir;
  await rm(project, { recursive: true, force: true });
  await rm(skills, { recursive: true, force: true });
});

interface Result {
  code: number;
  out: string;
  err: string;
}

/** Runs a command the way the binary would, but in-process so we can read its output. */
async function tasks(...argv: string[]): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (t) => out.push(t), err: (t) => err.push(t) }, project);
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** The same, with a document on stdin — the shape `update --markdown` expects. */
async function withInput(stdin: string, ...argv: string[]): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(
    argv,
    { out: (t) => out.push(t), err: (t) => err.push(t), input: () => Promise.resolve(stdin) },
    project,
  );
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** Runs a command and fails the test if it did not succeed. */
async function ok(...argv: string[]): Promise<Result> {
  const result = await tasks(...argv);
  assert.equal(result.code, EXIT_OK, `expected success, got: ${result.err}`);
  return result;
}

async function json<T>(...argv: string[]): Promise<T> {
  return JSON.parse((await ok(...argv, '--json')).out) as T;
}

async function seed(): Promise<void> {
  await ok('init');
  await ok('add', 'Fix auth redirect loop', '--category=auth', '--tags=bug,frontend');
  await ok('add', 'Rate limit the API', '--category=api', '--tags=infra');
  await ok('add', 'Document the store format', '--category=docs');
}

const idOf = async (title: string): Promise<string> => {
  const [task] = await json<Task[]>('list', `--query=${title}`);
  assert.ok(task, `no task titled ${title}`);
  return task.id;
};

describe('init', () => {
  it('creates the store and reports where', async () => {
    const result = await ok('init');
    assert.match(result.out, /Created .*\.tasks/);
  });

  it('installs the agent skill, and says it wrote outside the project', async () => {
    const result = await ok('init');
    assert.match(result.out, /Installed the agent skill/);
    assert.match(result.out, /outside this project/);
    assert.match(await readFile(join(skills, 'tasks', 'SKILL.md'), 'utf8'), /^---\nname: tasks\n/);
  });

  it('leaves the skill alone with --skip-skill', async () => {
    const result = await ok('init', '--skip-skill');
    assert.doesNotMatch(result.out, /skill/);
    await assert.rejects(readFile(join(skills, 'tasks', 'SKILL.md'), 'utf8'));
  });

  it('does not mention the skill again once it is current', async () => {
    await ok('init');
    await rm(join(project, '.tasks'), { recursive: true, force: true });
    assert.doesNotMatch((await ok('init')).out, /skill/);
  });

  it('creates .gitignore in a git repo', async () => {
    await mkdir(join(project, '.git'));
    const result = await ok('init');
    assert.match(result.out, /Created \.gitignore/);
    assert.equal(await readFile(join(project, '.gitignore'), 'utf8'), '.tasks/\n');
  });

  it('appends to an existing .gitignore without eating the last line', async () => {
    await writeFile(join(project, '.gitignore'), 'node_modules/');
    await ok('init');
    assert.equal(await readFile(join(project, '.gitignore'), 'utf8'), 'node_modules/\n.tasks/\n');
  });

  it('leaves an already-ignored store alone', async () => {
    await writeFile(join(project, '.gitignore'), '.tasks/\n');
    const result = await ok('init');
    assert.doesNotMatch(result.out, /gitignore/);
    assert.equal(await readFile(join(project, '.gitignore'), 'utf8'), '.tasks/\n');
  });

  it('does not invent a .gitignore outside a git repo', async () => {
    const result = await ok('init');
    assert.match(result.out, /Not a git repo/);
    await assert.rejects(readFile(join(project, '.gitignore'), 'utf8'));
  });

  it('is safe to run twice', async () => {
    await ok('init');
    assert.match((await ok('init')).out, /already exists/);
  });

  it('defaults the prefix to the project directory name', async () => {
    const result = await ok('init');
    assert.match(result.out, /Using task ID prefix/);
    assert.deepEqual(await readConfig(join(project, '.tasks')), {
      prefix: sanitizePrefix(basename(project)),
      nextId: 1,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('accepts an explicit --prefix', async () => {
    await ok('init', '--prefix=tt');
    assert.deepEqual(await readConfig(join(project, '.tasks')), {
      prefix: 'tt',
      nextId: 1,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('accepts -p as shorthand for --prefix', async () => {
    await ok('init', '-p', 'tt');
    assert.deepEqual(await readConfig(join(project, '.tasks')), {
      prefix: 'tt',
      nextId: 1,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('sanitises an explicit prefix', async () => {
    await ok('init', '--prefix=My Cool Repo!!');
    assert.deepEqual(await readConfig(join(project, '.tasks')), {
      prefix: 'my-cool-repo',
      nextId: 1,
      statuses: [...DEFAULT_STATUSES],
    });
  });

  it('rejects a --prefix with a digit-only segment', async () => {
    const result = await tasks('init', '--prefix=foo-2');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /digit/);
  });

  it('does not let a repeat init change the prefix', async () => {
    await ok('init', '--prefix=tt');
    const result = await ok('init', '--prefix=other');
    assert.match(result.out, /set once/);
    assert.deepEqual(await readConfig(join(project, '.tasks')), {
      prefix: 'tt',
      nextId: 1,
      statuses: [...DEFAULT_STATUSES],
    });
  });
});

describe('add', () => {
  it('defaults status to backlog and reports the new ID', async () => {
    await ok('init');
    const result = await ok('add', 'Something to do');
    assert.match(result.out, /^Added [a-z][a-z0-9-]*-\d+ {2}Something to do {2}\(backlog\)$/);
  });

  it('joins an unquoted title rather than truncating it', async () => {
    await ok('init');
    await ok('add', 'Document', 'the', 'store', 'format');
    const [task] = await json<Task[]>('list');
    assert.equal(task?.title, 'Document the store format');
  });

  it('accepts every field', async () => {
    await ok('init');
    await ok(
      'add',
      'Full task',
      '--category=auth',
      '--tags=bug,frontend',
      '--status=priority',
      '--notes=line one\nline two',
      '--refs=src/auth.ts:42-58,docs/adr.md',
    );
    const [task] = await json<Task[]>('list');
    assert.equal(task?.category, 'auth');
    assert.deepEqual(task?.tags, ['bug', 'frontend']);
    assert.equal(task?.status, 'priority');
    assert.equal(task?.notes, 'line one\nline two');
    assert.deepEqual(task?.refs, ['src/auth.ts:42-58', 'docs/adr.md']);
  });

  it('requires a title', async () => {
    await ok('init');
    const result = await tasks('add');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /a title is required/);
  });

  it('refuses a field that is not in the schema', async () => {
    await ok('init');
    const result = await tasks('add', 'x', '--assignee=me');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /unknown flag --assignee/);
  });
});

describe('list', () => {
  it('prints one line per task plus a per-column summary', async () => {
    await seed();
    const result = await ok('list');
    const lines = result.out.split('\n');
    assert.equal(lines.filter((line) => line.startsWith('t')).length, 3);
    assert.match(result.out, /backlog 3 {2}·/);
  });

  it('drops the summary when a filter is applied', async () => {
    await seed();
    const result = await ok('list', '--category=auth');
    assert.doesNotMatch(result.out, /backlog 3/);
  });

  it('filters by status, category, tag and query', async () => {
    await seed();
    assert.equal((await json<Task[]>('list', '--category=api')).length, 1);
    assert.equal((await json<Task[]>('list', '--tag=bug')).length, 1);
    assert.equal((await json<Task[]>('list', '--query=redirect')).length, 1);
    assert.equal((await json<Task[]>('list', '--status=backlog')).length, 3);
    assert.equal((await json<Task[]>('list', '--status=done')).length, 0);
  });

  it('accepts several statuses at once', async () => {
    await seed();
    await ok('move', await idOf('Rate limit'), 'done');
    assert.equal((await json<Task[]>('list', '--status=backlog,done')).length, 3);
  });

  it('says something useful when there is nothing to show', async () => {
    await ok('init');
    assert.match((await ok('list')).out, /No tasks yet/);
    assert.match((await ok('list', '--tag=bug')).out, /No tasks match/);
  });

  it('rejects a status that does not exist, listing the ones that do', async () => {
    await seed();
    const result = await tasks('list', '--status=blocked');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /backlog, priority, in-progress, done/);
  });

  it('takes flags, not arguments', async () => {
    await seed();
    const result = await tasks('list', 'priority');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /takes no arguments/);
  });
});

describe('show', () => {
  it('prints the fields and the notes body', async () => {
    await seed();
    const id = await idOf('Fix auth');
    await ok('note', id, 'Root cause: double encoding.');
    const result = await ok('show', id);
    assert.match(result.out, /status {4}backlog/);
    assert.match(result.out, /tags {6}bug, frontend/);
    assert.match(result.out, /Root cause: double encoding\./);
  });

  it('reports an unknown ID with a way to recover', async () => {
    await seed();
    const result = await tasks('show', 'tzzzzzzzz');
    assert.equal(result.code, EXIT_FAILED);
    assert.match(result.err, /tasks list/);
  });
});

describe('update', () => {
  it('changes only what was given', async () => {
    await seed();
    const id = await idOf('Fix auth');
    await ok('update', id, '--tags=urgent');
    const [task] = await json<Task[]>('list', `--query=Fix auth`);
    assert.deepEqual(task?.tags, ['urgent']);
    assert.equal(task?.category, 'auth', 'category must be untouched');
  });

  it('clears a field with an empty value', async () => {
    await seed();
    await ok('update', await idOf('Fix auth'), '--tags=');
    const [task] = await json<Task[]>('list', '--query=Fix auth');
    assert.deepEqual(task?.tags, []);
  });

  it('requires something to change', async () => {
    await seed();
    const result = await tasks('update', await idOf('Fix auth'));
    assert.equal(result.code, EXIT_FAILED);
    assert.match(result.err, /nothing to change/);
  });
});

describe('the markdown document', () => {
  it('shows a task as a document and reads the same document back', async () => {
    await seed();
    const id = await idOf('Fix auth');
    await ok('note', id, 'Root cause: double encoding.');

    const document = (await ok('show', id, '--markdown')).out;
    assert.match(document, new RegExp(`^---\\nid: ${id}\\n`));
    assert.match(document, /^title: Fix auth redirect loop$/m);
    assert.match(document, /^tags: \[bug, frontend\]$/m);
    assert.match(document, /Root cause: double encoding\./);

    // Unchanged in, unchanged out: a save with no edits must not rewrite anything.
    const before = await json<Task[]>('show', id);
    await withInput(document, 'update', id, '--markdown');
    const after = await json<Task[]>('show', id);
    assert.deepEqual({ ...after, updated: '' }, { ...before, updated: '' });
  });

  it('applies edits to every field the document carries', async () => {
    await seed();
    const id = await idOf('Fix auth');
    const edited = [
      '---',
      `id: ${id}`,
      'title: Fix the redirect loop',
      'status: in-progress',
      'category: auth',
      'tags: [bug, urgent]',
      'refs:',
      '  - src/auth.ts:42-58',
      '---',
      '',
      'Unwrap redirectTo once.',
    ].join('\n');

    assert.equal((await withInput(edited, 'update', id, '--markdown')).code, EXIT_OK);

    const task = await json<Task>('show', id);
    assert.equal(task.title, 'Fix the redirect loop');
    assert.equal(task.status, 'in-progress');
    assert.deepEqual(task.tags, ['bug', 'urgent']);
    assert.deepEqual(task.refs, ['src/auth.ts:42-58']);
    assert.equal(task.notes, 'Unwrap redirectTo once.');
  });

  it('refuses a document belonging to another task', async () => {
    await seed();
    const mine = await idOf('Fix auth');
    const theirs = await idOf('Rate limit');
    const document = (await ok('show', theirs, '--markdown')).out;

    const result = await withInput(document, 'update', mine, '--markdown');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, new RegExp(`document is task '${theirs}'`));
  });

  it('refuses to mix the document with field flags', async () => {
    await seed();
    const id = await idOf('Fix auth');
    const result = await withInput('---\ntitle: t\n---\n', 'update', id, '--markdown', '--tags=x');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /--tags/);
  });

  it('rejects a bad document without touching the task', async () => {
    await seed();
    const id = await idOf('Fix auth');
    const before = await json<Task>('show', id);

    const result = await withInput(
      `---\nid: ${id}\nassignee: me\n---\n`,
      'update',
      id,
      '--markdown',
    );
    assert.equal(result.code, EXIT_FAILED);
    assert.match(result.err, /assignee/);
    assert.deepEqual(await json<Task>('show', id), before);
  });
});

describe('note', () => {
  it('appends rather than replacing', async () => {
    await seed();
    const id = await idOf('Fix auth');
    await ok('note', id, 'First finding.');
    await ok('note', id, 'Second finding.');
    const [task] = await json<Task[]>('list', '--query=Fix auth');
    assert.equal(task?.notes, 'First finding.\n\nSecond finding.');
  });

  it('joins an unquoted note', async () => {
    await seed();
    const id = await idOf('Fix auth');
    await ok('note', id, 'root', 'cause', 'found');
    const [task] = await json<Task[]>('list', '--query=Fix auth');
    assert.equal(task?.notes, 'root cause found');
  });

  it('needs both an ID and some text', async () => {
    await seed();
    assert.equal((await tasks('note', await idOf('Fix auth'))).code, EXIT_USAGE);
  });
});

describe('move', () => {
  it('changes column and appends to the end by default', async () => {
    await seed();
    await ok('move', await idOf('Fix auth'), 'priority');
    await ok('move', await idOf('Rate limit'), 'priority');
    const column = await json<Task[]>('list', '--status=priority');
    assert.deepEqual(
      column.map((task) => task.title),
      ['Fix auth redirect loop', 'Rate limit the API'],
    );
  });

  it('positions before a named neighbour', async () => {
    await seed();
    const first = await idOf('Fix auth');
    await ok('move', first, 'priority');
    await ok('move', await idOf('Rate limit'), 'priority', `--before=${first}`);
    const column = await json<Task[]>('list', '--status=priority');
    assert.deepEqual(
      column.map((task) => task.title),
      ['Rate limit the API', 'Fix auth redirect loop'],
    );
  });

  it('needs both an ID and a status', async () => {
    await seed();
    const result = await tasks('move', await idOf('Fix auth'));
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /tasks move <id> <status>/);
  });
});

describe('remove', () => {
  it('deletes the task once confirmed on stdin', async () => {
    await seed();
    const id = await idOf('Rate limit');
    const result = await withInput('y\n', 'remove', id);
    assert.equal(result.code, EXIT_OK, result.err);
    assert.match(result.out, /Remove .*Rate limit the API\?/);
    assert.match(result.out, /Removed .*Rate limit the API/);
    assert.equal((await json<Task[]>('list')).length, 2);
  });

  it('leaves the task alone when declined', async () => {
    await seed();
    const id = await idOf('Rate limit');
    const result = await withInput('n\n', 'remove', id);
    assert.equal(result.code, EXIT_OK, result.err);
    assert.match(result.out, /Aborted/);
    assert.equal((await json<Task[]>('list')).length, 3);
  });

  it('deletes without asking when forced', async () => {
    await seed();
    const id = await idOf('Rate limit');
    const result = await ok('remove', id, '--force');
    assert.match(result.out, /Removed .*Rate limit the API/);
    assert.equal((await json<Task[]>('list')).length, 2);
  });

  it('refuses to delete when there is no confirmation available and no --force', async () => {
    await seed();
    const id = await idOf('Rate limit');
    const result = await tasks('remove', id);
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /--force/);
    assert.equal((await json<Task[]>('list')).length, 3, 'nothing must be removed');
  });

  it('reports an unknown ID', async () => {
    await seed();
    assert.equal((await tasks('remove', 'tzzzzzzzz', '--force')).code, EXIT_FAILED);
  });
});

describe('bare number ids', () => {
  it("resolves a bare number to this project's prefix", async () => {
    await ok('init', '--prefix=tt');
    const created = await json<Task>('add', 'Something');
    const [n] = created.id.split('-').slice(-1);

    const byNumber = await json<Task>('show', n!);
    assert.equal(byNumber.id, created.id);
  });

  it('works for move, note and remove too', async () => {
    await ok('init', '--prefix=tt');
    const created = await json<Task>('add', 'Something');
    const n = created.id.split('-').at(-1)!;

    await ok('move', n, 'priority');
    await ok('note', n, 'a finding');
    assert.equal((await json<Task>('show', n)).status, 'priority');

    const result = await ok('remove', n, '--force');
    assert.match(result.out, /Removed/);
  });

  it("refuses an id qualified with a different project's prefix", async () => {
    await ok('init', '--prefix=tt');
    const result = await tasks('show', 'other-3');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /different project/);
  });

  it('passes a legacy-shaped id through unchanged, so pre-migration ids still resolve', async () => {
    await ok('init', '--prefix=tt');
    const result = await tasks('show', 't1ep9qf7v');
    assert.equal(result.code, EXIT_FAILED, 'a literal miss, not a usage error');
  });
});

describe('migrate-ids', () => {
  async function seedLegacyStore(): Promise<void> {
    await mkdir(join(project, '.tasks'), { recursive: true });
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
    await writeFile(
      join(project, '.tasks', 'tasks.jsonl'),
      `${JSON.stringify(older)}\n${JSON.stringify(newer)}\n`,
    );
  }

  it('refuses to read a legacy store until migrated', async () => {
    await seedLegacyStore();
    const result = await tasks('list');
    assert.equal(result.code, EXIT_FAILED);
    assert.match(result.err, /migrate-ids/);
  });

  it('converts every id and prints the mapping', async () => {
    await seedLegacyStore();
    const result = await ok('migrate-ids', '--prefix=tt');
    assert.match(result.out, /Migrated 2 tasks to prefix 'tt'/);
    assert.match(result.out, /t1ep9qf7v.*tt-1/);
    assert.match(result.out, /t4cygkdpg.*tt-2/);

    const listed = await json<Task[]>('list');
    const newer = listed.find((task) => task.title.startsWith('Newer'))!;
    assert.equal(newer.title, 'Newer task, references tt-1');
  });

  it('is a no-op the second time', async () => {
    await seedLegacyStore();
    await ok('migrate-ids', '--prefix=tt');
    const result = await ok('migrate-ids', '--prefix=tt');
    assert.match(result.out, /Nothing to migrate/);
  });

  it('defaults to the prefix already on record, not the repo name', async () => {
    await seedLegacyStore();
    await ok('migrate-ids', '--prefix=tt');
    await writeFile(
      join(project, '.tasks', 'tasks.jsonl'),
      `${(await readFile(join(project, '.tasks', 'tasks.jsonl'), 'utf8')).trimEnd()}\n${JSON.stringify(
        {
          id: 't7r278yn3',
          title: 'Third, still legacy',
          notes: '',
          category: '',
          tags: [],
          status: 'backlog',
          rank: 'z',
          created: '2026-08-21T10:00:00.000Z',
          updated: '2026-08-21T10:00:00.000Z',
          refs: [],
        },
      )}\n`,
    );
    const result = await ok('migrate-ids');
    assert.match(result.out, /prefix 'tt'/);
  });
});

describe('the shell contract', () => {
  it('prints usage with no command', async () => {
    assert.match((await ok()).out, /tasks <command>/);
  });

  it('prints per-command help without needing a store', async () => {
    assert.match((await ok('move', '--help')).out, /tasks move <id> <status>/);
  });

  it('rejects a command that does not exist, listing the ones that do', async () => {
    const result = await tasks('frobnicate');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /init, add, list, show, update, move, note, remove/);
  });

  it('tells you to run init when there is no store', async () => {
    const result = await tasks('list');
    assert.equal(result.code, EXIT_FAILED);
    assert.match(result.err, /tasks init/);
  });

  it('finds the store from a subdirectory', async () => {
    await seed();
    const nested = join(project, 'src', 'deep');
    await mkdir(nested, { recursive: true });
    const out: string[] = [];
    const code = await run(['list'], { out: (t) => out.push(t), err: () => {} }, nested);
    assert.equal(code, EXIT_OK);
    assert.match(out.join('\n'), /Fix auth redirect loop/);
  });

  it('honours -C', async () => {
    await seed();
    const out: string[] = [];
    const code = await run(
      ['list', '-C', project],
      { out: (t) => out.push(t), err: () => {} },
      tmpdir(),
    );
    assert.equal(code, EXIT_OK);
    assert.match(out.join('\n'), /Fix auth redirect loop/);
  });
});

describe('status', () => {
  it('lists the project statuses, and as JSON', async () => {
    await ok('init');
    assert.equal((await ok('status', 'list')).out, DEFAULT_STATUSES.join('\n'));
    assert.deepEqual(await json<string[]>('status', 'list'), [...DEFAULT_STATUSES]);
    // Bare `tasks status` behaves as `status list`.
    assert.equal((await ok('status')).out, DEFAULT_STATUSES.join('\n'));
  });

  it('adds a status, then lets a task be put in it', async () => {
    await ok('init');
    const added = await ok('status', 'add', 'review', '--after=in-progress');
    assert.match(added.out, /Added status 'review'/);
    assert.deepEqual(await json<string[]>('status', 'list'), [
      'backlog',
      'priority',
      'in-progress',
      'review',
      'done',
    ]);

    // The CLI now accepts the new column where it would have rejected it before.
    await ok('add', 'Look at the PR', '--status=review');
    const [task] = await json<Task[]>('list', '--status=review');
    assert.equal(task!.status, 'review');
    await ok('move', task!.id, 'done');
    assert.equal((await json<Task[]>('list', '--status=done'))[0]!.id, task!.id);
  });

  it('renames a status and carries its tasks with it', async () => {
    await ok('init');
    await ok('add', 'A task', '--status=priority');
    await ok('status', 'rename', 'priority', 'next-up');
    const [task] = await json<Task[]>('list', '--status=next-up');
    assert.equal(task!.title, 'A task');
  });

  it('reorders a status', async () => {
    await ok('init');
    await ok('status', 'reorder', 'done', '--before=backlog');
    assert.deepEqual(await json<string[]>('status', 'list'), [
      'done',
      'backlog',
      'priority',
      'in-progress',
    ]);
  });

  it('refuses to remove a non-empty status without --move-to, then obeys it', async () => {
    await ok('init');
    await ok('add', 'Stuck task', '--status=priority');

    const refused = await tasks('status', 'remove', 'priority');
    assert.equal(refused.code, EXIT_FAILED);
    assert.match(refused.err, /still holds 1 task/);

    await ok('status', 'remove', 'priority', '--move-to=backlog');
    assert.ok(!(await json<string[]>('status', 'list')).includes('priority'));
    const [task] = await json<Task[]>('list', '--status=backlog');
    assert.equal(task!.title, 'Stuck task');
  });

  it('reports an unknown subcommand as a usage error', async () => {
    await ok('init');
    const result = await tasks('status', 'frobnicate');
    assert.equal(result.code, EXIT_USAGE);
    assert.match(result.err, /not a subcommand/);
  });
});
