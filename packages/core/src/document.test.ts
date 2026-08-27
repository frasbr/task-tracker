import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTaskDocument, parseTaskDocument } from './document.ts';
import { TaskValidationError } from './validate.ts';
import type { Task } from './task.ts';

const task: Task = {
  id: 't1ep9qf7v',
  title: 'Fix auth redirect loop',
  notes: 'redirectTo is double-encoded.\n\n- unwrap it once\n- add a test',
  category: 'auth',
  tags: ['bug', 'frontend'],
  status: 'in-progress',
  rank: 'V',
  created: '2026-08-19T14:22:00.000Z',
  updated: '2026-08-20T09:00:00.000Z',
  refs: ['src/auth.ts:42-58', 'src/routes.ts'],
  blockedBy: ['task-tracker-3', 'task-tracker-5'],
};

/** What survives a round trip: everything the document carries. */
function roundTrip(input: Task): void {
  const { id, patch } = parseTaskDocument(formatTaskDocument(input));
  assert.equal(id, input.id);
  assert.deepEqual(patch, {
    title: input.title,
    status: input.status,
    category: input.category,
    tags: input.tags,
    refs: input.refs,
    blockedBy: input.blockedBy,
    notes: input.notes,
  });
}

describe('formatTaskDocument', () => {
  it('writes the header fields and the notes below the fence', () => {
    assert.equal(
      formatTaskDocument(task),
      [
        '---',
        'id: t1ep9qf7v',
        'title: Fix auth redirect loop',
        'status: in-progress',
        'category: auth',
        'tags: [bug, frontend]',
        'refs:',
        '  - src/auth.ts:42-58',
        '  - src/routes.ts',
        'blockedBy: [task-tracker-3, task-tracker-5]',
        '---',
        '',
        'redirectTo is double-encoded.',
        '',
        '- unwrap it once',
        '- add a test',
        '',
      ].join('\n'),
    );
  });

  it('leaves no trailing blank line when there are no notes', () => {
    const text = formatTaskDocument({ ...task, notes: '' });
    assert.ok(text.endsWith('---\n'), text);
  });

  it('writes empty fields without a dangling space', () => {
    const text = formatTaskDocument({ ...task, category: '', tags: [], refs: [], blockedBy: [] });
    assert.match(text, /^category:$/m);
    assert.match(text, /^tags: \[\]$/m);
    assert.match(text, /^refs: \[\]$/m);
    assert.match(text, /^blockedBy: \[\]$/m);
  });

  it('omits rank, created and updated — the store owns those', () => {
    const text = formatTaskDocument(task);
    for (const field of ['rank', 'created', 'updated']) {
      assert.ok(!text.includes(`${field}:`), `document should not carry ${field}`);
    }
  });
});

describe('parseTaskDocument', () => {
  it('round-trips a full task', () => {
    roundTrip(task);
  });

  it('round-trips empty fields', () => {
    roundTrip({ ...task, notes: '', category: '', tags: [], refs: [], blockedBy: [] });
  });

  it('parses blockedBy into the patch', () => {
    const { patch } = parseTaskDocument('---\nblockedBy: [task-tracker-3, task-tracker-5]\n---\n');
    assert.deepEqual(patch.blockedBy, ['task-tracker-3', 'task-tracker-5']);
  });

  it('parses an empty blockedBy into an empty list', () => {
    const { patch } = parseTaskDocument('---\nblockedBy: []\n---\n');
    assert.deepEqual(patch.blockedBy, []);
  });

  it('round-trips notes containing a horizontal rule', () => {
    roundTrip({ ...task, notes: 'before\n\n---\n\nafter' });
  });

  it('keeps a colon in the title without quoting', () => {
    roundTrip({ ...task, title: 'Fix: the redirect loop' });
  });

  it('accepts a list inline or one item per line', () => {
    const inline = parseTaskDocument('---\nrefs: [a.ts, b.ts:4]\n---\n');
    const block = parseTaskDocument('---\nrefs:\n  - a.ts\n  - b.ts:4\n---\n');
    assert.deepEqual(inline.patch.refs, ['a.ts', 'b.ts:4']);
    assert.deepEqual(block.patch.refs, inline.patch.refs);
  });

  it('accepts blockedBy inline or one item per line', () => {
    const inline = parseTaskDocument('---\nblockedBy: [task-tracker-3, task-tracker-5]\n---\n');
    const block = parseTaskDocument(
      '---\nblockedBy:\n  - task-tracker-3\n  - task-tracker-5\n---\n',
    );
    assert.deepEqual(inline.patch.blockedBy, ['task-tracker-3', 'task-tracker-5']);
    assert.deepEqual(block.patch.blockedBy, inline.patch.blockedBy);
  });

  it('reads an absent id as absent rather than failing', () => {
    const { id, patch } = parseTaskDocument('---\ntitle: No header id\n---\n');
    assert.equal(id, undefined);
    assert.equal(patch.title, 'No header id');
  });

  it('validates values the same way any other write is validated', () => {
    assert.throws(
      () => parseTaskDocument('---\nstatus: nearly-done\n---\n'),
      (error: unknown) =>
        error instanceof TaskValidationError && /is not a status/.test(error.message),
    );
  });

  it('rejects a field that is not part of the document', () => {
    assert.throws(
      () => parseTaskDocument('---\ntitle: t\nassignee: me\n---\n'),
      (error: unknown) => error instanceof TaskValidationError && error.field === 'assignee',
    );
  });

  it('rejects notes in the header, where they would fight the body', () => {
    assert.throws(
      () => parseTaskDocument('---\nnotes: sneaky\n---\n'),
      (error: unknown) => error instanceof TaskValidationError && error.field === 'notes',
    );
  });

  it('rejects a duplicated field rather than silently taking one', () => {
    assert.throws(
      () => parseTaskDocument('---\ntitle: one\ntitle: two\n---\n'),
      (error: unknown) =>
        error instanceof TaskValidationError && /appears twice/.test(error.message),
    );
  });

  it('names the problem when the header is missing or unclosed', () => {
    assert.throws(
      () => parseTaskDocument('title: no fence here\n'),
      (error: unknown) =>
        error instanceof TaskValidationError && /header fence/.test(error.message),
    );
    assert.throws(
      () => parseTaskDocument('---\ntitle: t\n'),
      (error: unknown) =>
        error instanceof TaskValidationError && /never closed/.test(error.message),
    );
  });

  it('explains a list written as a bare value', () => {
    assert.throws(
      () => parseTaskDocument('---\ntags: bug, frontend\n---\n'),
      (error: unknown) => error instanceof TaskValidationError && error.field === 'tags',
    );
  });

  it('ignores blank lines and indentation drift in the header', () => {
    const { patch } = parseTaskDocument('---\n\ntitle: t\n\nrefs:\n- a.ts\n\n---\n');
    assert.equal(patch.title, 't');
    assert.deepEqual(patch.refs, ['a.ts']);
  });
});
