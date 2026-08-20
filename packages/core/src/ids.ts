import { randomBytes } from 'node:crypto';

/**
 * Task IDs.
 *
 * These get quoted in conversation — by you to an agent, by an agent back to you — so
 * they are short and use an alphabet without the characters people mistype: no `i`,
 * `l`, `o` or `u`. The leading `t` keeps them greppable and stops them being read as
 * numbers by anything downstream.
 *
 * Random rather than sequential, because IDs must never be reused after a task is
 * deleted. A counter would hand a retired ID to a new task the moment the highest
 * task was removed; 40 bits of randomness means that effectively cannot happen, and
 * `nextId` additionally checks against the IDs currently in the store.
 */

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const BODY_LENGTH = 8;

export const ID_PREFIX = 't';

export class IdError extends Error {
  override readonly name = 'IdError';
}

export function isId(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (value.length !== ID_PREFIX.length + BODY_LENGTH) return false;
  if (!value.startsWith(ID_PREFIX)) return false;
  return [...value.slice(ID_PREFIX.length)].every((char) => ALPHABET.includes(char));
}

/** A random ID. Prefer `nextId` when the existing IDs are known. */
export function newId(): string {
  const bytes = randomBytes(BODY_LENGTH);
  let body = '';
  for (const byte of bytes) {
    body += ALPHABET[byte % ALPHABET.length]!;
  }
  return ID_PREFIX + body;
}

/** A random ID that is not already in `taken`. */
export function nextId(taken: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = newId();
    if (!taken.has(candidate)) return candidate;
  }
  throw new IdError(
    `Could not allocate an unused task ID after 100 attempts with ${taken.size} tasks in the store. This should be impossible — the ID generator is probably broken.`,
  );
}
