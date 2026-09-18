import type { Task, TaskStatus } from './task.ts';

/**
 * The only interface through which task data is read or written.
 *
 * JSONL is the shipping implementation; this interface exists so a SQLite backend
 * stays a contained swap rather than a rewrite.
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
}
