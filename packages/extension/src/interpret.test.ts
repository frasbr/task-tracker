import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { categoryStyle, classifyCliError, describeProblem, parseRef } from './interpret.ts';

const CHART_COLORS = new Set([
  'charts.red',
  'charts.orange',
  'charts.yellow',
  'charts.green',
  'charts.blue',
  'charts.purple',
]);

describe('categoryStyle', () => {
  it('has no style for an empty or whitespace category', () => {
    assert.equal(categoryStyle(''), undefined);
    assert.equal(categoryStyle('   '), undefined);
  });

  it('picks a colour from the charts palette and a two-letter badge', () => {
    const style = categoryStyle('auth');
    assert.ok(style);
    assert.ok(CHART_COLORS.has(style.colorId), `unexpected colour ${style.colorId}`);
    assert.equal(style.badge, 'au');
  });

  it('caps the badge at two characters, even for a one-letter category', () => {
    assert.equal(categoryStyle('x')?.badge, 'x');
    assert.equal(categoryStyle('infrastructure')?.badge, 'in');
  });

  it('is stable: the same category is always the same colour', () => {
    assert.equal(categoryStyle('auth')?.colorId, categoryStyle('auth')?.colorId);
    assert.equal(categoryStyle('docs')?.colorId, categoryStyle('  docs  ')?.colorId);
  });

  it('spreads a handful of categories across more than one colour', () => {
    const colours = new Set(
      ['auth', 'api', 'docs', 'infra', 'ui', 'build', 'tests'].map(
        (name) => categoryStyle(name)!.colorId,
      ),
    );
    assert.ok(colours.size > 1, 'every category hashed to the same colour');
  });
});

describe('parseRef', () => {
  it('reads a bare path', () => {
    assert.deepEqual(parseRef('src/auth.ts'), {
      path: 'src/auth.ts',
      startLine: undefined,
      endLine: undefined,
    });
  });

  it('reads a single line', () => {
    assert.deepEqual(parseRef('src/auth.ts:42'), {
      path: 'src/auth.ts',
      startLine: 42,
      endLine: undefined,
    });
  });

  it('reads a range', () => {
    assert.deepEqual(parseRef('src/auth.ts:42-58'), {
      path: 'src/auth.ts',
      startLine: 42,
      endLine: 58,
    });
  });

  it('keeps colons that are part of the path', () => {
    assert.equal(parseRef('weird:name/file.ts').path, 'weird:name/file.ts');
    assert.deepEqual(parseRef('weird:name/file.ts:9'), {
      path: 'weird:name/file.ts',
      startLine: 9,
      endLine: undefined,
    });
  });

  it('ignores a trailing colon that is not a line number', () => {
    assert.equal(parseRef('src/auth.ts:main').path, 'src/auth.ts:main');
  });

  it('drops a reversed range rather than selecting backwards', () => {
    assert.deepEqual(parseRef('src/auth.ts:58-42'), {
      path: 'src/auth.ts',
      startLine: 58,
      endLine: undefined,
    });
  });

  it('trims surrounding whitespace', () => {
    assert.equal(parseRef('  src/auth.ts:42  ').startLine, 42);
  });
});

describe('classifyCliError', () => {
  const command = 'tasks';
  const directory = '/projects/demo';

  it('reports a missing binary as something the user can fix', () => {
    assert.deepEqual(classifyCliError({ code: 'ENOENT' }, command, directory), {
      kind: 'cli-missing',
      attempted: 'tasks',
    });
    assert.equal(classifyCliError({ code: 'EACCES' }, command, directory).kind, 'cli-missing');
  });

  it('treats "run tasks init" as an empty project, not an error', () => {
    assert.deepEqual(
      classifyCliError(
        { stderr: 'No .tasks/ directory at or above /projects/demo. Run `tasks init` ...' },
        command,
        directory,
      ),
      { kind: 'no-store', directory },
    );
  });

  it('treats exit 2 as a version-skew bug, not a store problem', () => {
    assert.deepEqual(
      classifyCliError(
        { exitCode: 2, stderr: "update: unknown flag '--markdown'" },
        command,
        directory,
      ),
      { kind: 'cli-outdated', message: "update: unknown flag '--markdown'" },
    );
  });

  it('falls back to the error message for exit 2 with empty stderr', () => {
    assert.deepEqual(
      classifyCliError({ exitCode: 2, stderr: '', message: 'boom' }, command, directory),
      { kind: 'cli-outdated', message: 'boom' },
    );
  });

  it('surfaces any other stderr verbatim', () => {
    assert.deepEqual(
      classifyCliError({ stderr: '  tasks.jsonl:2: not valid JSON.  ' }, command, directory),
      { kind: 'cli-failed', message: 'tasks.jsonl:2: not valid JSON.' },
    );
  });

  it('falls back to the error message when stderr is empty', () => {
    assert.deepEqual(classifyCliError({ stderr: '', message: 'boom' }, command, directory), {
      kind: 'cli-failed',
      message: 'boom',
    });
  });

  it('always says something, even given nothing', () => {
    const problem = classifyCliError({}, command, directory);
    assert.equal(problem.kind, 'cli-failed');
    assert.ok(problem.kind === 'cli-failed' && problem.message.length > 0);
  });
});

describe('describeProblem', () => {
  it('covers every problem kind with non-empty words', () => {
    const problems: Parameters<typeof describeProblem>[0][] = [
      { kind: 'no-workspace' },
      { kind: 'no-store', directory: '/tmp/project' },
      { kind: 'cli-missing', attempted: 'tasks' },
      { kind: 'cli-outdated', message: 'boom' },
      { kind: 'cli-failed', message: 'boom' },
    ];

    for (const problem of problems) {
      const { heading, detail } = describeProblem(problem);
      assert.ok(heading.length > 0, `no heading for ${problem.kind}`);
      assert.ok(detail.length > 0, `no detail for ${problem.kind}`);
    }
  });

  it('names the directory it looked in', () => {
    const { detail } = describeProblem({ kind: 'no-store', directory: '/tmp/project' });
    assert.match(detail, /\/tmp\/project/);
  });

  it("passes the CLI's own message through as the hint", () => {
    const { hint } = describeProblem({ kind: 'cli-failed', message: 'tasks.jsonl:2: bad JSON' });
    assert.equal(hint, 'tasks.jsonl:2: bad JSON');
  });

  it('names the fix for an outdated CLI', () => {
    const { hint } = describeProblem({
      kind: 'cli-outdated',
      message: "unknown flag '--markdown'",
    });
    assert.match(hint ?? '', /unknown flag '--markdown'/);
    assert.match(hint ?? '', /npm run install-cli/);
  });
});
