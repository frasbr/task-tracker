import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Task } from '@task-tracker/core';
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
});

describe('add', () => {
  it('defaults status to backlog and reports the new ID', async () => {
    await ok('init');
    const result = await ok('add', 'Something to do');
    assert.match(result.out, /^Added t[0-9a-z]{8} {2}Something to do {2}\(backlog\)$/);
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
  it('deletes the task and names what went', async () => {
    await seed();
    const result = await ok('remove', await idOf('Rate limit'));
    assert.match(result.out, /Removed .*Rate limit the API/);
    assert.equal((await json<Task[]>('list')).length, 2);
  });

  it('reports an unknown ID', async () => {
    await seed();
    assert.equal((await tasks('remove', 'tzzzzzzzz')).code, EXIT_FAILED);
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
