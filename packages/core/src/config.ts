import { readFile } from 'node:fs/promises';
import { configFilePath } from './locate.ts';
import { writeFileAtomically } from './atomic.ts';
import { STATUSES } from './task.ts';

/**
 * The project's own config: `.tasks/config.json`, beside the store it configures.
 *
 * It holds the ID prefix and the counter that mints the next number — the counter is
 * monotonic and never derived from the tasks present, so a number retired by deleting a
 * task never comes back pointing at something else.
 *
 * It used to also hold the project's status list, back when the columns were
 * per-project (ADR 0019). docs/plans/0003-four-static-columns.md reversed that: the
 * columns are the schema now, fixed in `task.ts`, and a config is not asked.
 */

export interface ProjectConfig {
  prefix: string;
  nextId: number;
}

/** What a project gets when nothing has set a prefix explicitly. */
export const DEFAULT_PREFIX = 'task';

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Lowercases, collapses anything outside `[a-z0-9-]` into a single hyphen, and trims
 * leading/trailing hyphens. Falls back to `DEFAULT_PREFIX` if nothing survives — a
 * project named entirely in punctuation still gets a usable prefix.
 */
export function sanitizePrefix(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? DEFAULT_PREFIX : cleaned;
}

/**
 * Rejects a prefix with a hyphen-separated segment that is only digits. `foo-2` would
 * make the id `foo-2-7` and the document filename `foo-2-7-slug.md` ambiguous to parse
 * — both split on the last hyphen, and a digit-only segment could be either the prefix's
 * own part or the number. Sanitising already restricts the alphabet; this is one more
 * rule beside it.
 */
export function checkPrefix(prefix: string): void {
  const digitOnly = prefix.split('-').find((segment) => segment !== '' && /^[0-9]+$/.test(segment));
  if (digitOnly !== undefined) {
    throw new ConfigError(
      `'${prefix}' has '${digitOnly}', a part that is only digits. That makes '<prefix>-<n>' ` +
        `ids ambiguous to parse. Choose a prefix where every hyphen-separated part has a letter in it.`,
    );
  }
}

/**
 * A config may still carry a `statuses` key from before the columns were fixed (ADR
 * 0019, reversed by docs/plans/0003-four-static-columns.md). A key naming any subset of
 * the fixed columns is accepted and ignored — every config that predates this change is
 * exactly that case (the original four, a subset of today's five), so nothing has to be
 * rewritten on read. Anything naming a column outside the fixed set is a hard error:
 * silently dropping it would strand whatever tasks sit in a column that does not exist.
 */
function checkLegacyStatuses(value: unknown, where: string): void {
  if (value === undefined) return;

  const fixed = new Set<string>(STATUSES);
  const matches =
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && fixed.has(entry));
  if (matches) return;

  throw new ConfigError(
    `${where}: 'statuses' is ${JSON.stringify(value)}. The columns are fixed now — ` +
      `${STATUSES.join(', ')} — and this key is no longer read. Move any tasks sitting in ` +
      `a column that is not one of those, then delete 'statuses' from config.json.`,
  );
}

function parseConfig(raw: unknown, where: string): ProjectConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${where}: expected a config object.`);
  }
  const record = raw as Record<string, unknown>;

  const prefix = record['prefix'];
  if (typeof prefix !== 'string' || prefix === '') {
    throw new ConfigError(`${where}: 'prefix' must be a non-empty string.`);
  }
  checkPrefix(prefix);

  const nextId = record['nextId'];
  if (typeof nextId !== 'number' || !Number.isInteger(nextId) || nextId < 1) {
    throw new ConfigError(`${where}: 'nextId' must be a positive integer.`);
  }

  checkLegacyStatuses(record['statuses'], where);

  return { prefix, nextId };
}

/** The project's config, or `undefined` if `.tasks/config.json` does not exist yet. */
export async function readConfig(storeDir: string): Promise<ProjectConfig | undefined> {
  const path = configFilePath(storeDir);

  let contents: string;
  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new ConfigError(`${path}: not valid JSON.`);
  }

  return parseConfig(parsed, path);
}

export async function writeConfig(storeDir: string, config: ProjectConfig): Promise<void> {
  checkPrefix(config.prefix);
  await writeFileAtomically(configFilePath(storeDir), `${JSON.stringify(config, null, 2)}\n`);
}
