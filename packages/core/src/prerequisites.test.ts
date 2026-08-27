import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPrerequisites } from './prerequisites.ts';
import { TaskValidationError } from './validate.ts';
import type { Task } from './task.ts';

/** A minimal, valid task, so each test only has to state what it cares about. */
function task(id: string, blockedBy: string[] = []): Task {
  return {
    id,
    title: id,
    notes: '',
    category: '',
    tags: [],
    status: 'backlog',
    rank: 'V',
    created: '2026-08-19T10:00:00.000Z',
    updated: '2026-08-19T10:00:00.000Z',
    refs: [],
    blockedBy,
  };
}

describe('checkPrerequisites', () => {
  it('accepts a valid edge to a task that exists', () => {
    const tasks = [task('a'), task('b', ['a'])];
    assert.doesNotThrow(() => checkPrerequisites(tasks, 'b'));
  });

  it('accepts an empty blockedBy', () => {
    assert.doesNotThrow(() => checkPrerequisites([task('a')], 'a'));
  });

  it('rejects an id that is not in the store, and names it', () => {
    const tasks = [task('a', ['ghost'])];
    assert.throws(
      () => checkPrerequisites(tasks, 'a'),
      (error: unknown) => {
        assert.ok(error instanceof TaskValidationError);
        assert.match(error.message, /'ghost'/);
        assert.match(error.message, /no task with that ID exists/);
        assert.equal(error.field, 'blockedBy');
        return true;
      },
    );
  });

  it('rejects self-blocking as the degenerate cycle', () => {
    const tasks = [task('a', ['a'])];
    assert.throws(
      () => checkPrerequisites(tasks, 'a'),
      (error: unknown) => {
        assert.ok(error instanceof TaskValidationError);
        assert.match(error.message, /closes a cycle/);
        assert.match(error.message, /a → a/);
        return true;
      },
    );
  });

  it('rejects a two-task cycle', () => {
    // a already waits on b; wiring b to wait on a closes it.
    const tasks = [task('a', ['b']), task('b', ['a'])];
    assert.throws(() => checkPrerequisites(tasks, 'b'), /closes a cycle/);
  });

  it('rejects a longer cycle, naming the whole path', () => {
    // a -> b -> c -> a
    const tasks = [task('a', ['b']), task('b', ['c']), task('c', ['a'])];
    assert.throws(
      () => checkPrerequisites(tasks, 'c'),
      (error: unknown) => {
        assert.ok(error instanceof TaskValidationError);
        assert.match(error.message, /c → a → b → c/);
        return true;
      },
    );
  });

  it('accepts a diamond: two paths converging on the same ancestor', () => {
    // d waits on both b and c, which both wait on a. Two routes to a, not a cycle.
    const tasks = [task('a'), task('b', ['a']), task('c', ['a']), task('d', ['b', 'c'])];
    assert.doesNotThrow(() => checkPrerequisites(tasks, 'd'));
  });

  it('checks only the named task, not every edge in the store', () => {
    // 'b' already dangles (points at an id that is not present) — a check of 'a', which
    // does not touch that edge, must not fail because of it.
    const tasks = [task('a', []), task('b', ['ghost'])];
    assert.doesNotThrow(() => checkPrerequisites(tasks, 'a'));
  });
});
