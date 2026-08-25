import { isId } from './ids.ts';
import { isRank } from './rank.ts';
import { DEFAULT_STATUSES, isTaskStatus } from './task.ts';
import type { Task } from './task.ts';
import type { TaskDraft, TaskPatch } from './store.ts';

/**
 * Schema validation.
 *
 * The rule that matters here is that unknown fields are an error, never something to
 * ignore. Agents write to this store, and an agent given any latitude will add a
 * plausible-looking key — `priority`, `assignee`, `due` — that then silently does
 * nothing. Failing loudly is what keeps the ten-field model actually ten fields.
 *
 * Messages are written for two readers: a person in a terminal and an agent reading a
 * transcript. Both need to be told what to do next, not just what was wrong.
 */

/** The complete set of task fields. Adding one is a plan-level decision — see PLAN.md. */
export const TASK_FIELDS = [
  'id',
  'title',
  'notes',
  'category',
  'tags',
  'status',
  'rank',
  'created',
  'updated',
  'refs',
] as const satisfies readonly (keyof Task)[];

/** Fields a caller may supply when creating a task. */
const DRAFT_FIELDS = ['title', 'notes', 'category', 'tags', 'status', 'rank', 'refs'] as const;

/** Fields a caller may change. `id` and `created` are immutable; `updated` is automatic. */
const PATCH_FIELDS = DRAFT_FIELDS;

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** `src/auth.ts`, `src/auth.ts:42`, or `src/auth.ts:42-58`. */
const REF = /^[^\s:][^:]*(?::\d+(?:-\d+)?)?$/;

export class TaskValidationError extends Error {
  override readonly name = 'TaskValidationError';
  readonly field: string | undefined;

  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

function fail(message: string, field?: string): never {
  throw new TaskValidationError(message, field);
}

function asRecord(input: unknown, where: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    fail(`${where}: expected a task object, got ${describe(input)}.`);
  }
  return input as Record<string, unknown>;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    fail(
      `${where}: unknown field${unknown.length > 1 ? 's' : ''} ${unknown
        .map((key) => `'${key}'`)
        .join(', ')}. Tasks have exactly these fields: ${allowed.join(', ')}. ` +
        `If this field is genuinely needed, it is a change to PLAN.md § Data model, not something to add here.`,
      unknown[0],
    );
  }
}

// ---------------------------------------------------------------- field validators

function checkTitle(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where}: 'title' must be a string.`, 'title');
  const trimmed = value.trim();
  if (trimmed === '') fail(`${where}: 'title' cannot be empty.`, 'title');
  if (trimmed.includes('\n')) {
    fail(`${where}: 'title' is a single line. Put the detail in 'notes' instead.`, 'title');
  }
  return trimmed;
}

function checkNotes(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where}: 'notes' must be a string.`, 'notes');
  return value;
}

function checkCategory(value: unknown, where: string): string {
  if (typeof value !== 'string') fail(`${where}: 'category' must be a string.`, 'category');
  const trimmed = value.trim();
  if (trimmed.includes('\n')) fail(`${where}: 'category' must be a single line.`, 'category');
  return trimmed;
}

function checkTags(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${where}: 'tags' must be an array of strings.`, 'tags');
  }
  const tags = value.map((tag) => {
    if (typeof tag !== 'string') fail(`${where}: every entry in 'tags' must be a string.`, 'tags');
    const trimmed = tag.trim();
    if (trimmed === '') fail(`${where}: 'tags' cannot contain an empty tag.`, 'tags');
    if (/\s/.test(trimmed)) {
      fail(`${where}: tag '${trimmed}' contains whitespace. Use a hyphen instead.`, 'tags');
    }
    return trimmed;
  });
  return [...new Set(tags)].sort();
}

function checkStatus(value: unknown, where: string, statuses: readonly string[]): Task['status'] {
  if (!isTaskStatus(value, statuses)) {
    fail(
      `${where}: '${String(value)}' is not a status. Use one of: ${statuses.join(', ')}.`,
      'status',
    );
  }
  return value;
}

function checkRank(value: unknown, where: string): string {
  if (!isRank(value)) {
    fail(
      `${where}: '${String(value)}' is not a valid rank. Ranks are allocated by the store — do not set one by hand.`,
      'rank',
    );
  }
  return value;
}

function checkTimestamp(value: unknown, field: string, where: string): string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) {
    fail(
      `${where}: '${field}' must be an ISO 8601 timestamp, e.g. 2026-08-19T14:22:00.000Z.`,
      field,
    );
  }
  return value;
}

function checkRefs(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) {
    fail(`${where}: 'refs' must be an array of file references.`, 'refs');
  }
  const refs = value.map((ref) => {
    if (typeof ref !== 'string') fail(`${where}: every entry in 'refs' must be a string.`, 'refs');
    const trimmed = ref.trim();
    if (!REF.test(trimmed)) {
      fail(
        `${where}: '${trimmed}' is not a valid reference. Use a path, optionally with a line or range: src/auth.ts, src/auth.ts:42, src/auth.ts:42-58.`,
        'refs',
      );
    }
    return trimmed;
  });
  return [...new Set(refs)];
}

// ---------------------------------------------------------------- entry points

/**
 * Parses and normalises a complete task, as read from the store.
 *
 * `prefix` is the project's own — every id must belong to it, the same way status
 * validation checks against the project's config rather than a fixed enum. Pass
 * `undefined` only from a migration reading a store that still has legacy ids: it skips
 * the shape check and requires nothing more than a non-empty string, since the id is
 * about to be replaced anyway.
 *
 * `statuses` is the project's configured list. The store passes its config's list; the
 * default is the four names a fresh project has, so a caller that has no config yet still
 * validates against something sensible rather than accepting anything.
 */
export function parseTask(
  input: unknown,
  where: string,
  prefix: string | undefined,
  statuses: readonly string[] = DEFAULT_STATUSES,
): Task {
  const record = asRecord(input, where);
  rejectUnknownFields(record, TASK_FIELDS, where);

  for (const field of TASK_FIELDS) {
    if (!(field in record)) fail(`${where}: missing required field '${field}'.`, field);
  }

  const id = record['id'];
  if (prefix === undefined) {
    if (typeof id !== 'string' || id === '')
      fail(`${where}: 'id' must be a non-empty string.`, 'id');
  } else if (!isId(id, prefix)) {
    fail(`${where}: '${String(id)}' is not a valid task ID.`, 'id');
  }

  return {
    id,
    title: checkTitle(record['title'], where),
    notes: checkNotes(record['notes'], where),
    category: checkCategory(record['category'], where),
    tags: checkTags(record['tags'], where),
    status: checkStatus(record['status'], where, statuses),
    rank: checkRank(record['rank'], where),
    created: checkTimestamp(record['created'], 'created', where),
    updated: checkTimestamp(record['updated'], 'updated', where),
    refs: checkRefs(record['refs'], where),
  };
}

/**
 * Parses and normalises a new task's fields. The store allocates id, rank and timestamps.
 * An absent status defaults to the first configured column — a new task lands at the head
 * of the board, whatever that column is named.
 */
export function parseDraft(
  input: unknown,
  statuses: readonly string[] = DEFAULT_STATUSES,
  where = 'new task',
): TaskDraft {
  const record = asRecord(input, where);
  rejectUnknownFields(record, DRAFT_FIELDS, where);

  const draft: TaskDraft = {
    title: checkTitle(record['title'], where),
    notes: 'notes' in record ? checkNotes(record['notes'], where) : '',
    category: 'category' in record ? checkCategory(record['category'], where) : '',
    tags: 'tags' in record ? checkTags(record['tags'], where) : [],
    status: 'status' in record ? checkStatus(record['status'], where, statuses) : statuses[0]!,
    refs: 'refs' in record ? checkRefs(record['refs'], where) : [],
  };

  return 'rank' in record ? { ...draft, rank: checkRank(record['rank'], where) } : draft;
}

/** Parses a partial update. Absent fields are left alone; present ones are validated. */
export function parsePatch(
  input: unknown,
  statuses: readonly string[] = DEFAULT_STATUSES,
  where = 'update',
): TaskPatch {
  const record = asRecord(input, where);
  rejectUnknownFields(record, PATCH_FIELDS, where);

  if (Object.keys(record).length === 0) {
    fail(`${where}: nothing to change. Supply at least one of: ${PATCH_FIELDS.join(', ')}.`);
  }

  const patch: TaskPatch = {};
  if ('title' in record) patch.title = checkTitle(record['title'], where);
  if ('notes' in record) patch.notes = checkNotes(record['notes'], where);
  if ('category' in record) patch.category = checkCategory(record['category'], where);
  if ('tags' in record) patch.tags = checkTags(record['tags'], where);
  if ('status' in record) patch.status = checkStatus(record['status'], where, statuses);
  if ('rank' in record) patch.rank = checkRank(record['rank'], where);
  if ('refs' in record) patch.refs = checkRefs(record['refs'], where);
  return patch;
}
