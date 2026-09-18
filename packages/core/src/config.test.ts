import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  ConfigError,
  checkPrefix,
  checkStatusList,
  readConfig,
  sanitizePrefix,
  writeConfig,
} from './config.ts';
import { STATUSES } from './task.ts';

describe('sanitizePrefix', () => {
  it('lowercases', () => {
    assert.equal(sanitizePrefix('TaskTracker'), 'tasktracker');
  });

  it('collapses anything outside [a-z0-9-] into a single hyphen', () => {
    assert.equal(sanitizePrefix('My Cool Project!!'), 'my-cool-project');
  });

  it('trims leading and trailing hyphens', () => {
    assert.equal(sanitizePrefix('--edge--'), 'edge');
  });

  it('falls back to the default when nothing survives', () => {
    assert.equal(sanitizePrefix('!!!'), 'task');
    assert.equal(sanitizePrefix(''), 'task');
  });

  it('leaves an already-clean prefix alone', () => {
    assert.equal(sanitizePrefix('task-tracker'), 'task-tracker');
  });
});

describe('checkPrefix', () => {
  it('accepts a prefix with no digit-only segment', () => {
    assert.doesNotThrow(() => checkPrefix('task-tracker'));
    assert.doesNotThrow(() => checkPrefix('tt'));
    assert.doesNotThrow(() => checkPrefix('v2-app'));
  });

  it('rejects a digit-only segment, which would make ids ambiguous to parse', () => {
    assert.throws(() => checkPrefix('foo-2'), ConfigError);
    assert.throws(() => checkPrefix('2'), ConfigError);
    assert.throws(() => checkPrefix('a-1-b'), ConfigError);
  });
});

describe('readConfig / writeConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'task-tracker-config-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns undefined when config.json does not exist', async () => {
    assert.equal(await readConfig(dir), undefined);
  });

  it('round-trips what it wrote', async () => {
    await writeConfig(dir, { prefix: 'demo', nextId: 5, statuses: ['todo', 'doing', 'done'] });
    assert.deepEqual(await readConfig(dir), {
      prefix: 'demo',
      nextId: 5,
      statuses: ['todo', 'doing', 'done'],
    });
  });

  it('refuses to write a prefix with a digit-only segment', async () => {
    await assert.rejects(
      writeConfig(dir, { prefix: 'foo-2', nextId: 1, statuses: [...STATUSES] }),
      ConfigError,
    );
  });

  it('defaults statuses when the key is absent, so a phase-6 config still reads', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ prefix: 'demo', nextId: 1 }));
    assert.deepEqual(await readConfig(dir), {
      prefix: 'demo',
      nextId: 1,
      statuses: [...STATUSES],
    });
  });

  it('rejects an empty status list', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ prefix: 'demo', nextId: 1, statuses: [] }),
    );
    await assert.rejects(readConfig(dir), ConfigError);
  });

  it('rejects a status with whitespace or a duplicate', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ prefix: 'demo', nextId: 1, statuses: ['in progress'] }),
    );
    await assert.rejects(readConfig(dir), ConfigError);

    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ prefix: 'demo', nextId: 1, statuses: ['todo', 'todo'] }),
    );
    await assert.rejects(readConfig(dir), ConfigError);
  });

  it('rejects malformed JSON', async () => {
    await writeFile(join(dir, 'config.json'), 'not json');
    await assert.rejects(readConfig(dir), ConfigError);
  });

  it('rejects a missing or non-positive nextId', async () => {
    await writeFile(join(dir, 'config.json'), JSON.stringify({ prefix: 'demo', nextId: 0 }));
    await assert.rejects(readConfig(dir), ConfigError);
  });

  it('leaves no temporary files behind', async () => {
    await writeConfig(dir, { prefix: 'demo', nextId: 1, statuses: [...STATUSES] });
    const contents = await readFile(join(dir, 'config.json'), 'utf8');
    assert.deepEqual(JSON.parse(contents), {
      prefix: 'demo',
      nextId: 1,
      statuses: [...STATUSES],
    });
  });
});

describe('checkStatusList', () => {
  it('trims each name and preserves order', () => {
    assert.deepEqual(checkStatusList([' backlog ', 'done'], 'config'), ['backlog', 'done']);
  });

  it('rejects a non-array, an empty list, whitespace, and duplicates', () => {
    assert.throws(() => checkStatusList('todo', 'config'), ConfigError);
    assert.throws(() => checkStatusList([], 'config'), ConfigError);
    assert.throws(() => checkStatusList(['in progress'], 'config'), ConfigError);
    assert.throws(() => checkStatusList(['a', 'a'], 'config'), ConfigError);
  });
});
