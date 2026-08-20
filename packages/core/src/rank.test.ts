import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RANK_LENGTH_LIMIT,
  RankError,
  isRank,
  needsRenumber,
  rankBetween,
  renumberRanks,
} from './rank.ts';

describe('rankBetween', () => {
  it('places a first rank when the column is empty', () => {
    const rank = rankBetween(null, null);
    assert.ok(isRank(rank));
  });

  it('appends after an existing rank', () => {
    const first = rankBetween(null, null);
    const second = rankBetween(first, null);
    assert.ok(second > first, `${second} should sort after ${first}`);
  });

  it('prepends before an existing rank', () => {
    const first = rankBetween(null, null);
    const earlier = rankBetween(null, first);
    assert.ok(earlier < first, `${earlier} should sort before ${first}`);
  });

  it('inserts strictly between two neighbours', () => {
    const a = rankBetween(null, null);
    const c = rankBetween(a, null);
    const b = rankBetween(a, c);
    assert.ok(a < b && b < c, `expected ${a} < ${b} < ${c}`);
  });

  it('never produces a rank ending in the lowest digit', () => {
    let low = rankBetween(null, null);
    for (let i = 0; i < 200; i += 1) {
      low = rankBetween(null, low);
      assert.ok(isRank(low), `${low} is not canonical`);
    }
  });

  it('rejects reversed or equal bounds', () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    assert.throws(() => rankBetween(b, a), RankError);
    assert.throws(() => rankBetween(a, a), RankError);
  });

  it('rejects ranks outside the alphabet', () => {
    assert.throws(() => rankBetween('a!', null), RankError);
    assert.throws(() => rankBetween('', null), RankError);
    assert.throws(() => rankBetween('a0', null), RankError);
  });
});

describe('ordering under repeated inserts', () => {
  it('keeps a column strictly ordered through 200 random insertions', () => {
    const ranks: string[] = [rankBetween(null, null)];

    for (let i = 0; i < 200; i += 1) {
      const at = Math.floor(Math.random() * (ranks.length + 1));
      const before = at > 0 ? ranks[at - 1]! : null;
      const after = at < ranks.length ? ranks[at]! : null;
      ranks.splice(at, 0, rankBetween(before, after));
    }

    assert.equal(new Set(ranks).size, ranks.length, 'ranks must be unique');
    for (let i = 1; i < ranks.length; i += 1) {
      assert.ok(ranks[i - 1]! < ranks[i]!, `${ranks[i - 1]} should sort before ${ranks[i]}`);
    }
    assert.deepEqual(ranks, [...ranks].sort(), 'array order must match sort order');
  });

  it('survives the worst case: always inserting into the same gap', () => {
    let low = rankBetween(null, null);
    let high = rankBetween(low, null);

    for (let i = 0; i < 100; i += 1) {
      const middle = rankBetween(low, high);
      assert.ok(low < middle && middle < high);
      high = middle;
    }
    assert.ok(low < high);
  });
});

describe('renumbering', () => {
  it('flags a column whose keys have grown past the limit', () => {
    assert.equal(needsRenumber(['V', 'l']), false);
    assert.equal(needsRenumber(['V', 'a'.repeat(RANK_LENGTH_LIMIT + 1)]), true);
  });

  it('produces the requested number of short, ordered, canonical ranks', () => {
    for (const count of [0, 1, 2, 5, 61, 62, 200, 5000]) {
      const ranks = renumberRanks(count);
      assert.equal(ranks.length, count, `expected ${count} ranks`);
      assert.ok(ranks.every(isRank), 'every rank must be canonical');
      assert.deepEqual(ranks, [...ranks].sort(), 'ranks must be generated in order');
      assert.equal(new Set(ranks).size, count, 'ranks must be unique');
    }
  });

  it('leaves room to insert between renumbered neighbours', () => {
    const ranks = renumberRanks(50);
    for (let i = 1; i < ranks.length; i += 1) {
      const between = rankBetween(ranks[i - 1]!, ranks[i]!);
      assert.ok(ranks[i - 1]! < between && between < ranks[i]!);
    }
  });

  it('rejects nonsense counts', () => {
    assert.throws(() => renumberRanks(-1), RankError);
    assert.throws(() => renumberRanks(1.5), RankError);
  });
});
