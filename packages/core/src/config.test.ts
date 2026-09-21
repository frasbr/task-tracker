import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ConfigError, checkPrefix, readConfig, sanitizePrefix, writeConfig } from './config.ts';

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
    await writeConfig(dir, { prefix: 'demo', nextId: 5 });
    assert.deepEqual(await readConfig(dir), { prefix: 'demo', nextId: 5 });
  });

  it('refuses to write a prefix with a digit-only segment', async () => {
    await assert.rejects(writeConfig(dir, { prefix: 'foo-2', nextId: 1 }), ConfigError);
  });

  it('accepts and ignores a legacy statuses key naming a subset of the fixed columns', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        prefix: 'demo',
        nextId: 1,
        statuses: ['backlog', 'priority', 'in-progress', 'done'],
      }),
    );
    assert.deepEqual(await readConfig(dir), { prefix: 'demo', nextId: 1 });
  });

  it('accepts and ignores a legacy statuses key naming a smaller subset of the fixed columns', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ prefix: 'demo', nextId: 1, statuses: ['backlog', 'priority'] }),
    );
    assert.deepEqual(await readConfig(dir), { prefix: 'demo', nextId: 1 });
  });

  it('rejects a legacy statuses key naming anything outside the fixed columns', async () => {
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({ prefix: 'demo', nextId: 1, statuses: ['todo', 'doing', 'done'] }),
    );
    await assert.rejects(readConfig(dir), (error: unknown) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /'statuses' is/);
      assert.match(error.message, /backlog, priority, in-progress, in-review, done/);
      return true;
    });
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
    await writeConfig(dir, { prefix: 'demo', nextId: 1 });
    const contents = await readFile(join(dir, 'config.json'), 'utf8');
    assert.deepEqual(JSON.parse(contents), { prefix: 'demo', nextId: 1 });
  });
});
