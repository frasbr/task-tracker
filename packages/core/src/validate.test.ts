import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskValidationError, parseDraft, parsePatch, parseTask } from './validate.ts';

const VALID = {
  id: 't2k4m9x7q',
  title: 'Fix auth redirect loop',
  notes: 'Repro: log in from /settings.\n\nBounces twice.',
  category: 'auth',
  tags: ['bug', 'frontend'],
  status: 'in-progress',
  rank: 'V',
  created: '2026-08-19T10:04:00.000Z',
  updated: '2026-08-19T14:22:00.000Z',
  refs: ['src/auth.ts:42-58'],
};

describe('parseTask', () => {
  it('accepts a well-formed task', () => {
    assert.deepEqual(parseTask(VALID, 'test'), VALID);
  });

  it('rejects unknown fields, and names them', () => {
    assert.throws(
      () => parseTask({ ...VALID, assignee: 'me', due: 'tomorrow' }, 'test'),
      (error: unknown) => {
        assert.ok(error instanceof TaskValidationError);
        assert.match(error.message, /'assignee'/);
        assert.match(error.message, /'due'/);
        assert.match(error.message, /PLAN\.md/, 'should point at where the schema is decided');
        assert.equal(error.field, 'assignee');
        return true;
      },
    );
  });

  it('rejects a missing field', () => {
    const { category, ...missing } = VALID;
    void category;
    assert.throws(() => parseTask(missing, 'test'), /missing required field 'category'/);
  });

  it('rejects an invalid status and lists the valid ones', () => {
    assert.throws(
      () => parseTask({ ...VALID, status: 'blocked' }, 'test'),
      /backlog, priority, in-progress, done/,
    );
  });

  it('rejects a multi-line title', () => {
    assert.throws(() => parseTask({ ...VALID, title: 'one\ntwo' }, 'test'), /single line/);
  });

  it('rejects a rank that is not canonical', () => {
    assert.throws(() => parseTask({ ...VALID, rank: 'a0' }, 'test'), /not a valid rank/);
  });

  it('rejects a non-ISO timestamp', () => {
    assert.throws(() => parseTask({ ...VALID, created: '19 Aug 2026' }, 'test'), /ISO 8601/);
  });

  it('rejects a malformed code reference', () => {
    assert.throws(() => parseTask({ ...VALID, refs: [':::'] }, 'test'), /not a valid reference/);
  });

  it('accepts references with and without line information', () => {
    const task = parseTask({ ...VALID, refs: ['src/a.ts', 'src/b.ts:42', 'src/c.ts:1-9'] }, 'test');
    assert.deepEqual(task.refs, ['src/a.ts', 'src/b.ts:42', 'src/c.ts:1-9']);
  });

  it('normalises tags: trimmed, deduplicated, sorted', () => {
    const task = parseTask({ ...VALID, tags: [' ui ', 'bug', 'ui'] }, 'test');
    assert.deepEqual(task.tags, ['bug', 'ui']);
  });

  it('rejects tags containing whitespace', () => {
    assert.throws(() => parseTask({ ...VALID, tags: ['needs triage'] }, 'test'), /hyphen/);
  });

  it('preserves multi-line notes exactly', () => {
    const notes = 'line one\n\n  indented\ttab\nquote " backslash \\ end';
    assert.equal(parseTask({ ...VALID, notes }, 'test').notes, notes);
  });

  it('rejects things that are not objects', () => {
    for (const input of [null, 'a string', 42, ['array']]) {
      assert.throws(() => parseTask(input, 'test'), TaskValidationError);
    }
  });
});

describe('parseDraft', () => {
  it('fills in sensible defaults from a title alone', () => {
    assert.deepEqual(parseDraft({ title: 'Rate limit the API' }), {
      title: 'Rate limit the API',
      notes: '',
      category: '',
      tags: [],
      status: 'backlog',
      refs: [],
    });
  });

  it('refuses fields the store allocates', () => {
    assert.throws(() => parseDraft({ title: 'x', id: 't2k4m9x7q' }), /unknown field 'id'/);
    assert.throws(() => parseDraft({ title: 'x', created: VALID.created }), /unknown field/);
  });

  it('requires a title', () => {
    assert.throws(() => parseDraft({ notes: 'orphan' }), /'title'/);
    assert.throws(() => parseDraft({ title: '   ' }), /cannot be empty/);
  });
});

describe('parsePatch', () => {
  it('validates only the fields present', () => {
    assert.deepEqual(parsePatch({ status: 'done' }), { status: 'done' });
  });

  it('rejects an empty patch with a list of what can change', () => {
    assert.throws(() => parsePatch({}), /nothing to change/);
  });

  it('refuses immutable fields', () => {
    assert.throws(() => parsePatch({ id: 't2k4m9x7q' }), /unknown field 'id'/);
    assert.throws(() => parsePatch({ created: VALID.created }), /unknown field 'created'/);
  });
});
