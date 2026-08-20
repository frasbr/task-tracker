import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UsageError, flagList, flagSet, flagValue, parseArgs, rejectUnknownFlags } from './args.ts';

describe('parseArgs', () => {
  it('separates the command from its positionals', () => {
    const args = parseArgs(['move', 't1ep9qf7v', 'done']);
    assert.equal(args.command, 'move');
    assert.deepEqual(args.positionals, ['t1ep9qf7v', 'done']);
  });

  it('accepts --flag=value', () => {
    assert.equal(flagValue(parseArgs(['add', '--category=auth']), 'category'), 'auth');
  });

  it('accepts --flag value', () => {
    assert.equal(flagValue(parseArgs(['add', '--category', 'auth']), 'category'), 'auth');
  });

  it('accepts an empty value, which is how a field gets cleared', () => {
    assert.deepEqual(flagList(parseArgs(['update', 't1', '--tags=']), 'tags'), []);
  });

  it('treats the known switches as booleans', () => {
    const args = parseArgs(['list', '--json']);
    assert.equal(flagSet(args, 'json'), true);
    assert.deepEqual(args.positionals, []);
  });

  it('reads -h as --help and -C as a directory', () => {
    assert.equal(flagSet(parseArgs(['list', '-h']), 'help'), true);
    assert.equal(flagValue(parseArgs(['list', '-C', '/tmp']), 'C'), '/tmp');
  });

  it('lets -- pass a leading dash through as text', () => {
    const args = parseArgs(['note', 't1', '--', '--not-a-flag']);
    assert.deepEqual(args.positionals, ['t1', '--not-a-flag']);
  });

  it('splits comma-separated lists and trims them', () => {
    assert.deepEqual(flagList(parseArgs(['add', '--tags=bug, frontend ,,ui']), 'tags'), [
      'bug',
      'frontend',
      'ui',
    ]);
  });

  it('refuses a value flag with nothing after it', () => {
    assert.throws(() => parseArgs(['add', '--category']), UsageError);
    assert.throws(() => parseArgs(['add', '--category', '--json']), /needs a value/);
    assert.throws(() => parseArgs(['list', '-C']), /needs a directory/);
  });
});

describe('rejectUnknownFlags', () => {
  it('names the flag it did not recognise', () => {
    assert.throws(
      () => rejectUnknownFlags(parseArgs(['add', '--assignee=me']), ['category'], 'add'),
      /unknown flag --assignee/,
    );
  });

  it('always allows the global flags', () => {
    const args = parseArgs(['list', '--json', '-C', '/tmp']);
    assert.doesNotThrow(() => rejectUnknownFlags(args, [], 'list'));
  });
});
