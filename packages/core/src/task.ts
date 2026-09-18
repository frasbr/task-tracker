/**
 * The task model. Eleven fields, fixed.
 *
 * Adding a field here is a design decision, not an implementation detail —
 * see AGENTS.md before you extend this type.
 */

/**
 * The four columns, fixed. Order here is the left-to-right order on the board and
 * top-to-bottom in the sidebar. See docs/plans/0003-four-static-columns.md, which
 * reverses ADR 0019's per-project configurability.
 */
export const STATUSES = ['backlog', 'priority', 'in-progress', 'done'] as const;

/**
 * A column name. Fixed at compile time, off `STATUSES`. Use `isTaskStatus(value)` to
 * check an unknown value against it.
 */
export type TaskStatus = (typeof STATUSES)[number];

/** The only status code branches on. A prerequisite in this column reads as finished. */
export const DONE: TaskStatus = 'done';

/** A pointer into real code, e.g. `src/auth.ts` or `src/auth.ts:42-58`. */
export type TaskRef = string;

export interface Task {
  /**
   * `<prefix>-<n>`, e.g. `task-tracker-7`. The prefix is the project's own; the number
   * is monotonic and never reused. Survives reordering, editing and status changes.
   */
  id: string;
  /** One-line headline shown on the card. */
  title: string;
  /** Markdown body. May be multi-line; the CLI owns escaping. */
  notes: string;
  /** Single bucket. Drives grouping and colour-coding. */
  category: string;
  /** Many per task. Drives filtering. */
  tags: string[];
  status: TaskStatus;
  /** Manual position within a column. Sorts lexicographically. */
  rank: string;
  /** ISO 8601. Set once, never rewritten. */
  created: string;
  /** ISO 8601. Touched on every write. */
  updated: string;
  refs: TaskRef[];
  /**
   * Ids of tasks this one waits on. The store rejects an id that does not exist and an
   * edge that would close a cycle (see prerequisites.ts) — but display only otherwise:
   * nothing here refuses to move a task whose prerequisites are outstanding.
   */
  blockedBy: string[];
}

/** True when `value` is one of the four statuses. */
export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}
