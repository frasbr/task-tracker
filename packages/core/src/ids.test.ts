import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatId, isId, isLegacyId, parseId, rewriteLegacyIds } from './ids.ts';

describe('formatId / parseId', () => {
  it('round-trips a prefix and a number', () => {
    assert.equal(formatId('task-tracker', 7), 'task-tracker-7');
    assert.deepEqual(parseId('task-tracker-7'), { prefix: 'task-tracker', n: 7 });
  });

  it('splits on the last hyphen, so a hyphenated prefix survives', () => {
    assert.deepEqual(parseId('my-project-42'), { prefix: 'my-project', n: 42 });
  });

  it('rejects a value with no hyphen', () => {
    assert.equal(parseId('task7'), undefined);
  });

  it('rejects a non-numeric tail', () => {
    assert.equal(parseId('task-tracker-abc'), undefined);
  });

  it('rejects a leading zero', () => {
    assert.equal(parseId('task-tracker-07'), undefined);
  });

  it('rejects zero itself', () => {
    assert.equal(parseId('task-tracker-0'), undefined);
  });

  it('rejects a trailing hyphen with nothing after it', () => {
    assert.equal(parseId('task-tracker-'), undefined);
  });
});

describe('isId', () => {
  it('accepts an id that belongs to the given prefix', () => {
    assert.equal(isId('task-tracker-7', 'task-tracker'), true);
  });

  it('rejects an id belonging to a different prefix', () => {
    assert.equal(isId('other-7', 'task-tracker'), false);
  });

  it('rejects non-strings', () => {
    assert.equal(isId(42, 'task-tracker'), false);
    assert.equal(isId(undefined, 'task-tracker'), false);
  });
});

describe('legacy ids', () => {
  it('recognises the old opaque shape', () => {
    assert.equal(isLegacyId('t1ep9qf7v'), true);
  });

  it('rejects the excluded characters even at the right length', () => {
    assert.equal(isLegacyId('tiiiiiiii'), false);
  });

  it('rejects a new-format id', () => {
    assert.equal(isLegacyId('task-tracker-7'), false);
  });

  it('rewrites every mapped id it finds in text, leaving the rest alone', () => {
    const mapping = new Map([
      ['t1ep9qf7v', 'task-tracker-3'],
      ['t4cygkdpg', 'task-tracker-5'],
    ]);
    const text = 'Blocked on t1ep9qf7v and t4cygkdpg, unrelated to t7r278yn3.';
    assert.equal(
      rewriteLegacyIds(text, mapping),
      'Blocked on task-tracker-3 and task-tracker-5, unrelated to t7r278yn3.',
    );
  });
});
