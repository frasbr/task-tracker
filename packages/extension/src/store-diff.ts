/**
 * Which task ids changed between two snapshots of the store, by `updated` timestamp.
 *
 * Kept away from `vscode`, the same way interpret.ts and task-naming.ts are, so it can
 * be tested without an editor around it. store-watcher.ts is the only caller: this is
 * what decides which open task documents actually need to reload after an external
 * write, rather than bouncing every open buffer on every change.
 */
export function changedIds(
  previous: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): string[] {
  const changed: string[] = [];

  for (const [id, updated] of current) {
    if (previous.get(id) !== updated) changed.push(id);
  }
  for (const id of previous.keys()) {
    if (!current.has(id)) changed.push(id);
  }

  return changed;
}
