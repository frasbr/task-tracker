import type { TaskPatch } from './store.ts';
import type { Task } from './task.ts';
import { STATUSES } from './task.ts';
import { TaskValidationError, parsePatch } from './validate.ts';

/**
 * A task rendered as an editable text document, and read back again.
 *
 * This exists so a task can be opened as an ordinary editor tab — frontmatter for the
 * scalar fields, markdown below for the notes. The store is still JSONL and the CLI is
 * still its only writer; this is a projection, not a second storage format.
 *
 * Two rules keep it honest:
 *
 * - The document exposes seven fields, not eleven. `rank`, `created` and `updated` are
 *   the store's to allocate, so putting them in an editable buffer would only invite
 *   edits that have to be thrown away. `id` is written but read back as an assertion
 *   about which task this is, never as something to change.
 * - Unknown header fields are an error, the same way they are in the store. A document
 *   is another surface an agent can write, so it gets the same loud failure.
 *
 * The header syntax is deliberately not YAML: a `key: value` line, where the value is
 * the rest of the line verbatim, plus lists written either inline as `[a, b]` or as one
 * `  - item` per line. That is small enough to hand-edit without surprises, and it means
 * a title containing a colon needs no quoting. Nothing here needs a YAML dependency, and
 * a real YAML parser would accept far more than this format is willing to mean.
 */

const FENCE = '---';

/**
 * Header fields, in the order they are written. `id` leads and is not editable.
 * Otherwise the same order as `TASK_FIELDS` in validate.ts, with `blockedBy` last as it
 * is there too — a reader who knows one field order can rely on the other.
 */
const HEADER_FIELDS = ['id', 'title', 'status', 'category', 'tags', 'refs', 'blockedBy'] as const;

const LIST_FIELDS: ReadonlySet<string> = new Set(['tags', 'refs', 'blockedBy']);

/** What a document says: which task it claims to be, and the fields it sets. */
export interface TaskDocument {
  /** From the `id` header. Absent if the header was deleted; the caller supplies context. */
  id: string | undefined;
  patch: TaskPatch;
}

function fail(message: string, field?: string): never {
  throw new TaskValidationError(message, field);
}

// ---------------------------------------------------------------- writing

/** Renders a task as its document. Round-trips through `parseTaskDocument`. */
export function formatTaskDocument(task: Task): string {
  const header = [
    scalar('id', task.id),
    scalar('title', task.title),
    scalar('status', task.status),
    scalar('category', task.category),
    list('tags', task.tags),
    list('refs', task.refs),
    list('blockedBy', task.blockedBy),
  ].join('\n');

  const notes = task.notes.trim();
  const front = `${FENCE}\n${header}\n${FENCE}\n`;
  return notes === '' ? front : `${front}\n${notes}\n`;
}

function scalar(key: string, value: string): string {
  return value === '' ? `${key}:` : `${key}: ${value}`;
}

/**
 * Refs go one per line because a path may contain a comma or a space. Tags and task ids
 * can contain neither, so `tags` and `blockedBy` stay inline where they are easier to
 * read and to edit.
 */
function list(key: string, values: readonly string[]): string {
  if (values.length === 0) return `${key}: []`;
  if (key === 'refs') return [`${key}:`, ...values.map((value) => `  - ${value}`)].join('\n');
  return `${key}: [${values.join(', ')}]`;
}

// ---------------------------------------------------------------- reading

/**
 * Reads a document back into a patch. Every value goes through the same validation as
 * any other write, so a bad status or a stray field fails here rather than on disk.
 *
 * Leading and trailing blank lines around the notes are not significant — the document
 * is the task as text, not a byte-exact mirror of the store.
 */
export function parseTaskDocument(
  text: string,
  statuses: readonly string[] = STATUSES,
  where = 'task document',
): TaskDocument {
  const lines = text.split('\n');

  const opening = lines.findIndex((line) => line.trim() !== '');
  if (opening < 0 || lines[opening]!.trim() !== FENCE) {
    fail(`${where}: expected the document to open with a '${FENCE}' header fence.`);
  }

  const closing = lines.findIndex((line, index) => index > opening && line.trim() === FENCE);
  if (closing < 0) {
    fail(`${where}: the '${FENCE}' header fence is never closed.`);
  }

  const record = readHeader(lines.slice(opening + 1, closing), where);
  const id = typeof record['id'] === 'string' ? record['id'] : undefined;
  delete record['id'];

  // The body is the notes in full, including any '---' of its own: only the first fence
  // after the header closes it, so a horizontal rule in the notes is just text.
  record['notes'] = lines
    .slice(closing + 1)
    .join('\n')
    .replace(/^\s*\n/, '')
    .trimEnd();

  return { id, patch: parsePatch(record, statuses, where) };
}

function readHeader(lines: readonly string[], where: string): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  let open: string[] | undefined;

  for (const line of lines) {
    if (line.trim() === '') continue;

    const item = line.trim();
    if (item.startsWith('- ')) {
      if (open === undefined) {
        fail(`${where}: '${item}' is a list item, but no list field precedes it.`);
      }
      const value = item.slice(2).trim();
      if (value !== '') open.push(value);
      continue;
    }

    const colon = line.indexOf(':');
    if (colon < 0) {
      fail(`${where}: '${item}' is not a 'field: value' line.`);
    }

    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();

    if (!(HEADER_FIELDS as readonly string[]).includes(key)) {
      fail(
        `${where}: '${key}' is not a field of a task document. The header holds exactly: ` +
          `${HEADER_FIELDS.join(', ')}. Notes go in the body, below the closing '${FENCE}'.`,
        key,
      );
    }
    if (key in record) {
      fail(`${where}: '${key}' appears twice in the header.`, key);
    }

    if (!LIST_FIELDS.has(key)) {
      record[key] = value;
      open = undefined;
      continue;
    }

    if (value === '') {
      const items: string[] = [];
      record[key] = items;
      open = items;
    } else if (value.startsWith('[') && value.endsWith(']')) {
      record[key] = splitInline(value);
      open = undefined;
    } else {
      fail(
        `${where}: '${key}' is a list. Write it as \`${key}: [a, b]\`, as \`${key}: []\`, ` +
          `or as one \`  - item\` per line beneath \`${key}:\`.`,
        key,
      );
    }
  }

  return record;
}

function splitInline(value: string): string[] {
  return value
    .slice(1, -1)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}
