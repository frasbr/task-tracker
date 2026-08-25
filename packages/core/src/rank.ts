/**
 * Ranks: the manual ordering of cards within a column.
 *
 * A rank is a string over a base-62 alphabet chosen so that ASCII string comparison
 * *is* the sort order. Inserting between two neighbours means finding a string
 * strictly between their ranks, which is always possible — so a normal insert never
 * touches any other task's rank. That is the whole point: dragging one card must not
 * rewrite the column.
 *
 * The cost is key length. Repeatedly inserting into the same gap grows keys by a
 * character at a time — the "rank exhaustion" failure mode AGENTS.md warns about. It is
 * handled by `needsRenumber` + `renumberRanks`, which callers must check after a
 * write rather than waiting for keys to become absurd.
 *
 * Invariant, enforced everywhere: a rank is non-empty, uses only alphabet characters,
 * and never ends in the lowest digit. That last rule is what keeps keys canonical —
 * without it `1` and `10` would be indistinguishable positions with different strings.
 */

/** Base-62 digits in ASCII order, so `a < b` on strings matches digit order. */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const LOWEST = DIGITS[0]!;

/**
 * Keys longer than this mean a gap has been subdivided too many times. Twelve
 * characters is far past anything reachable by hand, so hitting it is a signal that
 * something is inserting in a loop.
 */
export const RANK_LENGTH_LIMIT = 12;

export class RankError extends Error {
  override readonly name = 'RankError';
}

export function isRank(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !value.endsWith(LOWEST) &&
    [...value].every((char) => DIGITS.includes(char))
  );
}

function digitIndex(char: string): number {
  const index = DIGITS.indexOf(char);
  if (index < 0) {
    throw new RankError(`'${char}' is not a rank character. Ranks use 0-9, A-Z and a-z.`);
  }
  return index;
}

/**
 * A string strictly between `a` and `b`, where `b === null` means "after everything".
 * `a === ''` means "before everything". Assumes both are canonical and `a < b`.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new RankError(`Ranks are out of order: '${a}' does not sort before '${b}'.`);
  }

  if (b !== null) {
    // Shared prefixes carry through untouched; recurse on the part that differs.
    let shared = 0;
    while (shared < b.length && (a[shared] ?? LOWEST) === b[shared]) {
      shared += 1;
    }
    if (shared > 0) {
      return b.slice(0, shared) + midpoint(a.slice(shared), b.slice(shared));
    }
  }

  const low = a === '' ? 0 : digitIndex(a[0]!);
  const high = b === null ? BASE : digitIndex(b[0]!);

  // Room for a digit between them: take it and stop.
  if (high - low > 1) {
    return DIGITS[Math.round(0.5 * (low + high))]!;
  }

  // Adjacent digits. If `b` has more to it, its first digit alone already sits between.
  if (b !== null && b.length > 1) {
    return b.slice(0, 1);
  }

  // Otherwise keep `a`'s leading digit and extend past its tail.
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

/**
 * A rank that sorts strictly after `before` and strictly before `after`.
 * Pass `null` for either end to mean "start of column" / "end of column".
 */
export function rankBetween(before: string | null, after: string | null): string {
  if (before !== null && !isRank(before)) {
    throw new RankError(`'${before}' is not a valid rank, so nothing can be placed after it.`);
  }
  if (after !== null && !isRank(after)) {
    throw new RankError(`'${after}' is not a valid rank, so nothing can be placed before it.`);
  }
  if (before !== null && after !== null && before >= after) {
    throw new RankError(
      `Cannot insert between '${before}' and '${after}': they are equal or already reversed.`,
    );
  }
  return midpoint(before ?? '', after);
}

/** True when the column's keys have grown enough that it should be renumbered. */
export function needsRenumber(ranks: readonly string[]): boolean {
  return ranks.some((rank) => rank.length > RANK_LENGTH_LIMIT);
}

/**
 * `count` fresh ranks, evenly spread and as short as possible, preserving order.
 *
 * Used to reset a column whose keys have grown. Spacing leaves at least one unused
 * slot between neighbours so the next few inserts stay short too.
 */
export function renumberRanks(count: number): string[] {
  if (!Number.isInteger(count) || count < 0) {
    throw new RankError(`Cannot renumber ${count} tasks: expected a non-negative integer.`);
  }
  if (count === 0) return [];

  // Widen until the space is at least twice the number of slots we need.
  let width = 1;
  while (BASE ** width < 2 * (count + 1)) {
    width += 1;
  }

  const span = BASE ** width;
  const ranks: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let value = Math.floor(((i + 1) * span) / (count + 1));
    // Canonical ranks never end in the lowest digit. The 2x headroom above guarantees
    // neighbours are at least two apart, so nudging up cannot collide.
    if (value % BASE === 0) value += 1;
    ranks.push(encode(value, width));
  }
  return ranks;
}

function encode(value: number, width: number): string {
  let out = '';
  let remaining = value;
  for (let i = 0; i < width; i += 1) {
    out = DIGITS[remaining % BASE]! + out;
    remaining = Math.floor(remaining / BASE);
  }
  return out;
}
