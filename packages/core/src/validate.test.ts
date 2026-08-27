import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TaskValidationError, parseDraft, parsePatch, parseTask } from './validate.ts';

const VALID = {
  id: 'task-tracker-7',
  title: 'Fix auth redirect loop',
  notes: 'Repro: log in from /settings.\n\nBounces twice.',
  category: 'auth',
  tags: ['bug', 'frontend'],
  status: 'in-progress',
  rank: 'V',
  created: '2026-08-19T10:04:00.000Z',
  updated: '2026-08-19T14:22:00.000Z',
  refs: ['src/auth.ts:42-58'],
  blockedBy: ['task-tracker-3'],
};

describe('parseTask', () => {
  it('accepts a well-formed task', () => {
    assert.deepEqual(parseTask(VALID, 'test', 'task-tracker'), VALID);
  });

  it('rejects unknown fields, and names them', () => {
    assert.throws(
      () => parseTask({ ...VALID, assignee: 'me', due: 'tomorrow' }, 'test', 'task-tracker'),
      (error: unknown) => {
        assert.ok(error instanceof TaskValidationError);
        assert.match(error.message, /'assignee'/);
        assert.match(error.message, /'due'/);
        assert.match(error.message, /AGENTS\.md/, 'should point at where the schema is decided');
        assert.equal(error.field, 'assignee');
        return true;
      },
    );
  });

  it('rejects a missing field', () => {
    const { category, ...missing } = VALID;
    void category;
    assert.throws(
      () => parseTask(missing, 'test', 'task-tracker'),
      /missing required field 'category'/,
    );
  });

  it('rejects an invalid status and lists the valid ones', () => {
    assert.throws(
      () => parseTask({ ...VALID, status: 'blocked' }, 'test', 'task-tracker'),
      /backlog, priority, in-progress, done/,
    );
  });

  it('rejects a multi-line title', () => {
    assert.throws(
      () => parseTask({ ...VALID, title: 'one\ntwo' }, 'test', 'task-tracker'),
      /single line/,
    );
  });

  it('rejects a rank that is not canonical', () => {
    assert.throws(
      () => parseTask({ ...VALID, rank: 'a0' }, 'test', 'task-tracker'),
      /not a valid rank/,
    );
  });

  it('rejects a non-ISO timestamp', () => {
    assert.throws(
      () => parseTask({ ...VALID, created: '19 Aug 2026' }, 'test', 'task-tracker'),
      /ISO 8601/,
    );
  });

  it('rejects a malformed code reference', () => {
    assert.throws(
      () => parseTask({ ...VALID, refs: [':::'] }, 'test', 'task-tracker'),
      /not a valid reference/,
    );
  });

  it('accepts references with and without line information', () => {
    const task = parseTask(
      { ...VALID, refs: ['src/a.ts', 'src/b.ts:42', 'src/c.ts:1-9'] },
      'test',
      'task-tracker',
    );
    assert.deepEqual(task.refs, ['src/a.ts', 'src/b.ts:42', 'src/c.ts:1-9']);
  });

  it('rejects a blockedBy entry that is not task-id shaped', () => {
    assert.throws(
      () => parseTask({ ...VALID, blockedBy: ['not an id'] }, 'test', 'task-tracker'),
      /not a valid task id/,
    );
  });

  it('rejects a blockedBy entry shaped like a file reference, not a task id', () => {
    assert.throws(
      () => parseTask({ ...VALID, blockedBy: ['src/auth.ts'] }, 'test', 'task-tracker'),
      /not a valid task id/,
    );
  });

  it('rejects blockedBy that is not an array', () => {
    assert.throws(
      () => parseTask({ ...VALID, blockedBy: 'task-tracker-3' }, 'test', 'task-tracker'),
      /'blockedBy' must be an array/,
    );
  });

  it('dedupes blockedBy on the way in', () => {
    const task = parseTask(
      { ...VALID, blockedBy: ['task-tracker-3', 'task-tracker-9', 'task-tracker-3'] },
      'test',
      'task-tracker',
    );
    assert.deepEqual(task.blockedBy, ['task-tracker-3', 'task-tracker-9']);
  });

  it('defaults blockedBy to [] when the field is absent, for rows written before it existed', () => {
    const { blockedBy, ...withoutBlockedBy } = VALID;
    void blockedBy;
    const task = parseTask(withoutBlockedBy, 'test', 'task-tracker');
    assert.deepEqual(task.blockedBy, []);
  });

  it('does not check that a blockedBy id exists or close a cycle — shape only here', () => {
    // 'task-tracker-7' is VALID's own id (self-block) and 'task-tracker-999' does not
    // exist in any store this parser can see. Both are shape-valid, so both pass:
    // existence and cycle checks are a whole-store concern that lives elsewhere.
    const task = parseTask(
      { ...VALID, blockedBy: ['task-tracker-7', 'task-tracker-999'] },
      'test',
      'task-tracker',
    );
    assert.deepEqual(task.blockedBy, ['task-tracker-7', 'task-tracker-999']);
  });

  it('normalises tags: trimmed, deduplicated, sorted', () => {
    const task = parseTask({ ...VALID, tags: [' ui ', 'bug', 'ui'] }, 'test', 'task-tracker');
    assert.deepEqual(task.tags, ['bug', 'ui']);
  });

  it('rejects tags containing whitespace', () => {
    assert.throws(
      () => parseTask({ ...VALID, tags: ['needs triage'] }, 'test', 'task-tracker'),
      /hyphen/,
    );
  });

  it('preserves multi-line notes exactly', () => {
    const notes = 'line one\n\n  indented\ttab\nquote " backslash \\ end';
    assert.equal(parseTask({ ...VALID, notes }, 'test', 'task-tracker').notes, notes);
  });

  it('rejects things that are not objects', () => {
    for (const input of [null, 'a string', 42, ['array']]) {
      assert.throws(() => parseTask(input, 'test', 'task-tracker'), TaskValidationError);
    }
  });

  it('rejects an id belonging to a different project', () => {
    assert.throws(
      () => parseTask({ ...VALID, id: 'other-project-7' }, 'test', 'task-tracker'),
      /not a valid task ID/,
    );
  });

  it('accepts any non-empty id when no prefix is given, for a lenient migration read', () => {
    const task = parseTask({ ...VALID, id: 't2k4m9x7q' }, 'test', undefined);
    assert.equal(task.id, 't2k4m9x7q');
  });

  it('still rejects an empty id with no prefix given', () => {
    assert.throws(() => parseTask({ ...VALID, id: '' }, 'test', undefined), /non-empty string/);
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
      blockedBy: [],
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

  it('dedupes blockedBy on the way in', () => {
    const draft = parseDraft({
      title: 'x',
      blockedBy: ['task-tracker-3', 'task-tracker-3', 'task-tracker-9'],
    });
    assert.deepEqual(draft.blockedBy, ['task-tracker-3', 'task-tracker-9']);
  });

  it('rejects a malformed blockedBy entry', () => {
    assert.throws(() => parseDraft({ title: 'x', blockedBy: ['nope'] }), /not a valid task id/);
  });

  it('round-trips through create then read: the deduped list survives a full draft-to-store cycle', () => {
    const draft = parseDraft({
      title: 'x',
      blockedBy: ['task-tracker-3', 'task-tracker-3', 'task-tracker-9'],
    });

    // Simulate what the store does: allocate the fields a draft does not carry, and
    // read the result back the way a line from tasks.jsonl is read.
    const stored = {
      id: 'task-tracker-42',
      ...draft,
      rank: 'V',
      created: VALID.created,
      updated: VALID.updated,
    };
    const task = parseTask(stored, 'test', 'task-tracker');
    assert.deepEqual(task.blockedBy, ['task-tracker-3', 'task-tracker-9']);
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

  it('sets blockedBy, deduped, when present', () => {
    assert.deepEqual(parsePatch({ blockedBy: ['task-tracker-3', 'task-tracker-3'] }), {
      blockedBy: ['task-tracker-3'],
    });
  });

  it('rejects a malformed blockedBy entry', () => {
    assert.throws(() => parsePatch({ blockedBy: ['nope'] }), /not a valid task id/);
  });
});
