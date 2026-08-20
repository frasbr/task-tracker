import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  STORE_DIR_NAME,
  STORE_FILE_NAME,
  createStoreDir,
  findStoreDir,
  storeFilePath,
} from './locate.ts';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'task-tracker-locate-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('findStoreDir', () => {
  it('finds a store in the directory it starts from', async () => {
    const store = await createStoreDir(root);
    assert.equal(await findStoreDir(root), store);
  });

  it('walks up from a nested directory, the way git does', async () => {
    const store = await createStoreDir(root);
    const nested = join(root, 'packages', 'core', 'src');
    await mkdir(nested, { recursive: true });
    assert.equal(await findStoreDir(nested), store);
  });

  it('returns undefined when there is no store above', async () => {
    const nested = join(root, 'deep', 'deeper');
    await mkdir(nested, { recursive: true });
    assert.equal(await findStoreDir(nested), undefined);
  });

  it('finds the nearest store when projects are nested', async () => {
    await createStoreDir(root);
    const inner = join(root, 'sub-project');
    await mkdir(inner, { recursive: true });
    const innerStore = await createStoreDir(inner);
    assert.equal(await findStoreDir(inner), innerStore);
  });

  it('ignores a file that happens to be named .tasks', async () => {
    const nested = join(root, 'child');
    await mkdir(nested, { recursive: true });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(nested, STORE_DIR_NAME), 'not a directory');
    assert.equal(await findStoreDir(nested), undefined);
  });
});

describe('createStoreDir', () => {
  it('is safe to call twice', async () => {
    const first = await createStoreDir(root);
    assert.equal(await createStoreDir(root), first);
  });

  it('does not create the JSONL file — empty and absent mean the same thing', async () => {
    const store = await createStoreDir(root);
    const { readdir } = await import('node:fs/promises');
    assert.deepEqual(await readdir(store), []);
  });
});

describe('storeFilePath', () => {
  it('points at the JSONL file inside the store directory', () => {
    assert.equal(storeFilePath('/a/.tasks'), join('/a/.tasks', STORE_FILE_NAME));
  });
});
