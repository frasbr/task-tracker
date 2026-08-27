import { TaskValidationError } from './validate.ts';
import type { Task } from './task.ts';

/**
 * Whole-store rules for `blockedBy` — the ones a single record cannot check itself.
 *
 * `parseTask` and its siblings in validate.ts see one record at a time, so the most they
 * can confirm about a `blockedBy` entry is that it looks like a task id. Whether that id
 * belongs to a task that actually exists, and whether following it ever leads back to the
 * task that named it, both need every task in the store — a view a per-record parser does
 * not have. This module is that view.
 *
 * The store's write path calls `checkPrerequisites` once it has built the task it is
 * about to write, alongside the per-record validation it already does. A future
 * `TaskStore` implementation calls the same function for the same reason it would call
 * `parseTask`: the rule belongs to the data model, not to JSONL.
 */

/**
 * Checks the `blockedBy` list of the task named `id` against every task in `tasks`, which
 * must already include that task at the value about to be written. Throws
 * `TaskValidationError` naming the missing id, or the cycle, on the first problem found.
 *
 * Only the named task's own edges are checked — not every `blockedBy` edge in the store.
 * A dangling pointer left behind by some other write (a task removed without its
 * dependents being updated, say) is that write's problem, not this one's.
 */
export function checkPrerequisites(tasks: readonly Task[], id: string): void {
  const byId = new Map(tasks.map((task) => [task.id, task] as const));
  const subject = byId.get(id);
  if (subject === undefined) return; // callers always pass a task that is in `tasks`

  for (const target of subject.blockedBy) {
    if (!byId.has(target)) {
      throw new TaskValidationError(
        `'${id}' cannot be blocked by '${target}': no task with that ID exists. ` +
          'Run `tasks list` to see the IDs that exist.',
        'blockedBy',
      );
    }
  }

  const cycle = findCycle(byId, id);
  if (cycle !== undefined) {
    throw new TaskValidationError(
      `'${id}' cannot be blocked by '${cycle[1]}': that closes a cycle — ${cycle.join(' → ')}.`,
      'blockedBy',
    );
  }
}

/**
 * A walk from `start`, following `blockedBy` edges outward, looking for a path back to
 * `start`. Self-blocking is the one-hop case: `start` in its own list. Returns the path
 * found, `start` to `start`, or `undefined` when nothing leads back.
 *
 * The store is small enough that a plain depth-first search — no shortest-path, no
 * indegree bookkeeping — is the obviously-correct choice over a cleverer one.
 *
 * `visited` remembers nodes already walked with no path back to `start`, so a shared
 * ancestor reached by two different routes (a diamond: two tasks blocked by the same
 * third) is walked once, not mistaken for a cycle just because it is seen twice.
 */
function findCycle(byId: ReadonlyMap<string, Task>, start: string): string[] | undefined {
  const path: string[] = [start];
  const visited = new Set<string>();

  function walk(id: string): string[] | undefined {
    const task = byId.get(id);
    if (task === undefined) return undefined; // an unknown id is checkPrerequisites's job
    for (const next of task.blockedBy) {
      if (next === start) return [...path, next];
      if (visited.has(next)) continue;
      visited.add(next);
      path.push(next);
      const found = walk(next);
      if (found !== undefined) return found;
      path.pop();
    }
    return undefined;
  }

  return walk(start);
}
