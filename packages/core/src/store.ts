import type { Task, TaskStatus } from './task.ts';

/**
 * The only interface through which task data is read or written.
 *
 * JSONL is the shipping implementation; this interface exists so a SQLite backend
 * stays a contained swap rather than a rewrite (PLAN.md § Deliberately deferred).
 * Nothing outside this package may import a concrete store — callers depend on
 * this type only.
 */

export interface TaskFilter {
  status?: TaskStatus | TaskStatus[];
  category?: string;
  /** Match tasks carrying every listed tag. */
  tags?: string[];
  /** Free-text match across title and notes. */
  query?: string;
}

/** Fields a caller may set on create. The rest are allocated by the store. */
export type TaskDraft = Omit<Task, 'id' | 'rank' | 'created' | 'updated'> &
  Partial<Pick<Task, 'rank'>>;

/** Fields a caller may change. `id` and `created` are immutable; `updated` is automatic. */
export type TaskPatch = Partial<Omit<Task, 'id' | 'created' | 'updated'>>;

/** Where a status sits relative to another in the ordered list. Absent means "at the end". */
export interface StatusPosition {
  after?: string;
  before?: string;
}

export interface TaskStore {
  list(filter?: TaskFilter): Promise<Task[]>;
  get(id: string): Promise<Task | undefined>;
  create(draft: TaskDraft): Promise<Task>;
  update(id: string, patch: TaskPatch): Promise<Task>;
  /** Move to a status, optionally positioned between two existing tasks. */
  move(
    id: string,
    status: TaskStatus,
    position?: { after?: string; before?: string },
  ): Promise<Task>;
  remove(id: string): Promise<void>;

  /** The project's ordered status list — the board's columns, left to right. */
  listStatuses(): Promise<string[]>;
  /** Adds a status at `position` (default: last). Returns the new ordered list. */
  addStatus(name: string, position?: StatusPosition): Promise<string[]>;
  /**
   * Renames a status, rewriting every task carrying the old name in the same write, so a
   * card is never left in a column that no longer exists. Returns the new ordered list.
   */
  renameStatus(from: string, to: string): Promise<string[]>;
  /** Reorders an existing status to `position` (default: last). Returns the new list. */
  reorderStatus(name: string, position?: StatusPosition): Promise<string[]>;
  /**
   * Removes a status. Refuses unless the column is empty or `moveTo` names where its
   * tasks go; moved tasks are appended to the destination with fresh ranks. Returns the
   * new ordered list.
   */
  removeStatus(name: string, moveTo?: string): Promise<string[]>;
}
