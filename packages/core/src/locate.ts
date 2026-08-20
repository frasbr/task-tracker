import { mkdir, stat } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

/**
 * Finding a project's task store.
 *
 * The store lives in `.tasks/` at the project root, and both the CLI and the extension
 * find it the same way: walk up from wherever they were invoked until a `.tasks/`
 * directory appears. That means `tasks list` works from any subdirectory, the way git
 * does, and it is why neither caller ever needs a configured path.
 *
 * The walk deliberately does not stop at a `.git` boundary. Not every project this is
 * used in will be a git repo.
 */

export const STORE_DIR_NAME = '.tasks';
export const STORE_FILE_NAME = 'tasks.jsonl';

/** Path to the JSONL file inside a given `.tasks/` directory. */
export function storeFilePath(storeDir: string): string {
  return join(storeDir, STORE_FILE_NAME);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The nearest `.tasks/` directory at or above `from`, or `undefined` if there is none
 * between `from` and the filesystem root.
 */
export async function findStoreDir(from: string): Promise<string | undefined> {
  const root = parse(resolve(from)).root;
  let current = resolve(from);

  for (;;) {
    const candidate = join(current, STORE_DIR_NAME);
    if (await isDirectory(candidate)) return candidate;
    if (current === root) return undefined;
    current = dirname(current);
  }
}

/**
 * Creates `.tasks/` under `projectDir` if it is not already there, and returns its path.
 * Creating the JSONL file itself is left to the store — an empty file and a missing
 * file mean the same thing.
 */
export async function createStoreDir(projectDir: string): Promise<string> {
  const storeDir = join(resolve(projectDir), STORE_DIR_NAME);
  await mkdir(storeDir, { recursive: true });
  return storeDir;
}
