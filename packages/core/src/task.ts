/**
 * The task model. Ten fields, fixed by PLAN.md § Data model.
 *
 * Adding a field here is a plan-level decision, not an implementation detail —
 * see AGENTS.md before you extend this type.
 */

/** Column the card sits in. Order here is the left-to-right order on the board. */
export const TASK_STATUSES = ['backlog', 'priority', 'in-progress', 'done'] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

/** A pointer into real code, e.g. `src/auth.ts` or `src/auth.ts:42-58`. */
export type TaskRef = string;

export interface Task {
  /** Stable opaque handle. Survives reordering, editing and status changes. */
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
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}
