/**
 * The task model. Eleven fields, fixed.
 *
 * Adding a field here is a design decision, not an implementation detail —
 * see AGENTS.md before you extend this type.
 */

/**
 * The status list a project gets before its config sets one. Order here is the
 * left-to-right order on the board and top-to-bottom in the sidebar.
 *
 * These four are a default, not a schema: `.tasks/config.json` holds the project's own
 * ordered list, and validation checks a status against that list, not against this one.
 * A store with no config file behaves as if this were its list. See `config.ts`.
 */
export const DEFAULT_STATUSES = ['backlog', 'priority', 'in-progress', 'done'] as const;

/**
 * A column name. Per-project, so this is a plain `string` rather than a union — the set
 * of valid names lives in the config and is passed to validation, not fixed at compile
 * time. Use `isTaskStatus(value, statuses)` to check one against a known list.
 */
export type TaskStatus = string;

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

/** True when `value` is one of `statuses`. Defaults to the four names a fresh project has. */
export function isTaskStatus(
  value: unknown,
  statuses: readonly string[] = DEFAULT_STATUSES,
): value is TaskStatus {
  return typeof value === 'string' && statuses.includes(value);
}
