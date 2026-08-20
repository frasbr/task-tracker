import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ID_PREFIX, IdError, isId, newId, nextId } from './ids.ts';

describe('task IDs', () => {
  it('generates IDs of a fixed shape', () => {
    const id = newId();
    assert.ok(id.startsWith(ID_PREFIX));
    assert.equal(id.length, 9);
    assert.ok(isId(id));
  });

  it('omits the characters people mistype', () => {
    for (let i = 0; i < 500; i += 1) {
      assert.doesNotMatch(newId().slice(1), /[ilou]/, 'IDs must avoid i, l, o and u');
    }
  });

  it('does not collide across a realistic number of tasks', () => {
    const ids = new Set(Array.from({ length: 20_000 }, newId));
    assert.equal(ids.size, 20_000);
  });

  it('avoids IDs already in the store', () => {
    const taken = new Set([newId(), newId(), newId()]);
    for (let i = 0; i < 100; i += 1) {
      assert.equal(taken.has(nextId(taken)), false);
    }
  });

  it('gives up loudly rather than looping forever', () => {
    const everything = { has: () => true, size: 0 } as unknown as ReadonlySet<string>;
    assert.throws(() => nextId(everything), IdError);
  });

  it('rejects things that are not IDs', () => {
    assert.equal(isId('t123'), false, 'too short');
    assert.equal(isId('x12345678'), false, 'wrong prefix');
    assert.equal(isId('tiiiiiiii'), false, 'excluded characters');
    assert.equal(isId(42), false);
    assert.equal(isId(undefined), false);
  });
});
