import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyCliError, parseRef } from './interpret.ts';

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
