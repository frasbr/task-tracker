/**
 * Task IDs: `<prefix>-<n>`, e.g. `task-tracker-7`.
 *
 * The stored `id` is the whole qualified string, not a bare number with the prefix
 * applied at render time — the id is the handle people quote, so it should say what it
 * is. Parsing splits on the LAST hyphen, because the prefix itself may contain them.
 *
 * The number is never reused: it comes from a monotonic counter in the project's
 * config (see config.ts), not from the tasks currently in the store.
 */

export class IdError extends Error {
  override readonly name = 'IdError';
}

export interface ParsedId {
  prefix: string;
  n: number;
}

/** Splits `task-tracker-7` into its prefix and number, on the last hyphen. */
export function parseId(value: string): ParsedId | undefined {
  const at = value.lastIndexOf('-');
  if (at <= 0 || at === value.length - 1) return undefined;

  const digits = value.slice(at + 1);
  if (!/^[1-9][0-9]*$/.test(digits)) return undefined;

  return { prefix: value.slice(0, at), n: Number(digits) };
}

/** Formats a project's next number into its full id. */
export function formatId(prefix: string, n: number): string {
  return `${prefix}-${n}`;
}

/** Whether `value` is a valid id belonging to a project using `prefix`. */
export function isId(value: unknown, prefix: string): value is string {
  if (typeof value !== 'string') return false;
  const parsed = parseId(value);
  return parsed !== undefined && parsed.prefix === prefix;
}

// ---------------------------------------------------------------- legacy (pre-phase-6)

/**
 * The shape of an ID from before incremental IDs: `t` followed by 8 characters of an
 * alphabet without `i`, `l`, `o` or `u`. Kept only so `tasks migrate-ids` can find and
 * convert them — see migrate.ts.
 */
const LEGACY_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const LEGACY_ID_EXACT = new RegExp(`^t[${LEGACY_ALPHABET}]{8}$`);
const LEGACY_ID_ANYWHERE = new RegExp(`\\bt[${LEGACY_ALPHABET}]{8}\\b`, 'g');

export function isLegacyId(value: unknown): value is string {
  return typeof value === 'string' && LEGACY_ID_EXACT.test(value);
}

/**
 * Rewrites every legacy ID found in `text` using `mapping`, leaving anything not in the
 * mapping untouched — text that merely looks like a legacy ID but was never one of the
 * store's own is not something migration should be guessing about.
 */
export function rewriteLegacyIds(text: string, mapping: ReadonlyMap<string, string>): string {
  return text.replace(LEGACY_ID_ANYWHERE, (match) => mapping.get(match) ?? match);
}
