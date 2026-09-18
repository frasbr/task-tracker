import { checkPrefix } from './config.ts';
import type { ProjectConfig } from './config.ts';
import { formatId, isLegacyId, parseId, rewriteLegacyIds } from './ids.ts';
import type { Task } from './task.ts';

/**
 * The one-shot conversion off opaque legacy IDs onto `<prefix>-<n>`. See `ids.ts` for the
 * id format, and the CLI's `migrate-ids` verb, which is the only thing meant to call this.
 */

export interface IdMigration {
  config: ProjectConfig;
  /** Every task, legacy or not, with legacy ids and their cross-references rewritten. */
  tasks: Task[];
  /** Old id → new id. The only record of what a retired id became. */
  mapping: ReadonlyMap<string, string>;
}

/**
 * Renumbers every legacy id in `tasks` to `<prefix>-<n>`, assigning numbers in `created`
 * order so the numbering matches the order tasks were written, and rewrites every
 * cross-reference to a renumbered id found in a title or notes body.
 *
 * A task whose id already belongs to `prefix` is left exactly as it is and does not
 * consume a number — running this twice on a store that was already migrated (or one
 * that mixes migrated and legacy tasks) is safe, because numbering picks up after the
 * highest one already in use rather than always starting at 1.
 */
export function migrateIds(tasks: readonly Task[], prefix: string): IdMigration {
  checkPrefix(prefix);

  const ordered = [...tasks].sort((a, b) =>
    a.created < b.created ? -1 : a.created > b.created ? 1 : 0,
  );

  const highestExisting = ordered.reduce((max, task) => {
    const parsed = parseId(task.id);
    return parsed !== undefined && parsed.prefix === prefix ? Math.max(max, parsed.n) : max;
  }, 0);

  const mapping = new Map<string, string>();
  let next = highestExisting + 1;
  for (const task of ordered) {
    if (isLegacyId(task.id)) {
      mapping.set(task.id, formatId(prefix, next));
      next += 1;
    }
  }

  const migrated = ordered.map((task) => ({
    ...task,
    id: mapping.get(task.id) ?? task.id,
    title: rewriteLegacyIds(task.title, mapping),
    notes: rewriteLegacyIds(task.notes, mapping),
  }));

  return {
    config: { prefix, nextId: next },
    tasks: migrated,
    mapping,
  };
}
