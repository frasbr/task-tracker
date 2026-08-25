import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { columnLabel, idNumber } from './protocol.ts';

describe('columnLabel', () => {
  it('title-cases a single word', () => {
    assert.equal(columnLabel('backlog'), 'Backlog');
  });

  it('title-cases each hyphen-separated word', () => {
    assert.equal(columnLabel('in-progress'), 'In Progress');
    assert.equal(columnLabel('in-review'), 'In Review');
  });

  it('handles a custom status name with no table lookup', () => {
    assert.equal(columnLabel('shipped'), 'Shipped');
    assert.equal(columnLabel('waiting-on-review'), 'Waiting On Review');
  });
});

describe('idNumber', () => {
  it('takes the number off a prefixed id', () => {
    assert.equal(idNumber('task-tracker-7'), '7');
  });

  it('falls back to the whole id when it does not look prefixed', () => {
    assert.equal(idNumber('weird'), 'weird');
  });
});
