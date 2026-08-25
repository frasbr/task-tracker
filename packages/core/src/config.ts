import { readFile } from 'node:fs/promises';
import { configFilePath } from './locate.ts';
import { writeFileAtomically } from './atomic.ts';
import { DEFAULT_STATUSES } from './task.ts';

/**
 * The project's own config: `.tasks/config.json`, beside the store it configures.
 *
 * It holds the ID prefix and the counter that mints the next number (the counter is
 * monotonic and never derived from the tasks present, so a number retired by deleting a
 * task never comes back pointing at something else), plus the project's ordered status list — the columns of the board, validated
 * against here rather than against a compile-time enum.
 */

export interface ProjectConfig {
  prefix: string;
  nextId: number;
  /** The project's columns, in board order. Never empty. See `DEFAULT_STATUSES`. */
  statuses: string[];
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
 * Validates and normalises a project's status list. Each name is checked like a tag —
 * non-empty and whitespace-free — the list must be non-empty and free of duplicates,
 * and the returned order is preserved as given, since it is the board's column order.
 *
 * This is the one place the rules live, so `parseConfig`, `writeConfig` and (later) the
 * `tasks status` verbs all reject the same things the same way.
 */
export function checkStatusList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${where}: 'statuses' must be an array of names.`);
  }
  if (value.length === 0) {
    throw new ConfigError(
      `${where}: 'statuses' cannot be empty — a project needs at least one column.`,
    );
  }
  const seen = new Set<string>();
  const statuses = value.map((status) => {
    if (typeof status !== 'string') {
      throw new ConfigError(`${where}: every entry in 'statuses' must be a string.`);
    }
    const trimmed = status.trim();
    if (trimmed === '') {
      throw new ConfigError(`${where}: 'statuses' cannot contain an empty name.`);
    }
    if (/\s/.test(trimmed)) {
      throw new ConfigError(
        `${where}: status '${trimmed}' contains whitespace. Use a hyphen instead.`,
      );
    }
    if (seen.has(trimmed)) {
      throw new ConfigError(`${where}: status '${trimmed}' is listed more than once.`);
    }
    seen.add(trimmed);
    return trimmed;
  });
  return statuses;
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

  // A config written before statuses existed (phase 6) has no `statuses` key. It gets
  // the defaults, so an older store keeps working without a rewrite on read.
  const statuses =
    'statuses' in record ? checkStatusList(record['statuses'], where) : [...DEFAULT_STATUSES];

  return { prefix, nextId, statuses };
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
  checkStatusList(config.statuses, 'config');
  await writeFileAtomically(configFilePath(storeDir), `${JSON.stringify(config, null, 2)}\n`);
}
