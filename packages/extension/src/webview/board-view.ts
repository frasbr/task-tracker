import type { BoardTask } from '../protocol.ts';

/**
 * The board's filter and sort, kept as pure functions away from the DOM so they can be
 * tested without a webview around them — the same split as `drop-position.ts`.
 *
 * These are a view concern: nothing here writes to the store, and the choices they act on
 * live only in the webview (tt-15). Sorting reads the schema's own fields, so it needs no
 * new one — `rank` is the manual order, `updated` is recency, `created` is age.
 */

export type SortKey = 'rank' | 'updated' | 'created';

export interface BoardFilter {
  /** A single category, or `''` for all. */
  category: string;
  /** A single tag, or `''` for all. */
  tag: string;
}

/** Keeps the tasks that pass both filters. An empty filter matches everything. */
export function filterTasks(tasks: readonly BoardTask[], filter: BoardFilter): BoardTask[] {
  return tasks.filter((task) => {
    if (filter.category !== '' && task.category !== filter.category) return false;
    if (filter.tag !== '' && !task.tags.includes(filter.tag)) return false;
    return true;
  });
}

/**
 * A sorted copy of one column's cards. `rank` is the manual drag order; `updated` is
 * most-recent-first and `created` is oldest-first — both on ISO timestamps, which order
 * correctly as plain strings, so no date parsing is needed.
 */
export function sortColumn(tasks: readonly BoardTask[], sort: SortKey): BoardTask[] {
  const sorted = [...tasks];
  switch (sort) {
    case 'rank':
      return sorted.sort((a, b) => compare(a.rank, b.rank));
    case 'updated':
      return sorted.sort((a, b) => compare(b.updated, a.updated));
    case 'created':
      return sorted.sort((a, b) => compare(a.created, b.created));
  }
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
