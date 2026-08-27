# Whole-store rules live in their own core module, not in the store

`blockedBy` needs two checks that a single record cannot answer for itself: does an id it
names belong to a task that exists, and does following it ever lead back to where it
started. Both need every task in the store — a view `parseTask` and its siblings in
validate.ts do not have, by design; they check one record at a time.

Two places could hold that view. `jsonl.ts` already reads every task before it writes any
of them, the same way `renameStatus` does, so the checks could sit right there, beside the
read. Or they could live in a module of their own, one `jsonl.ts` calls into.

The store was rejected. A check written against the file format would need rewriting, not
reusing, the day a SQLite backend replaces it — the swap [ADR 0002](0002-core-owns-the-store-behind-an-interface.md)
deliberately leaves open. `prerequisites.ts` depends on nothing but the `Task` type, so
any `TaskStore` calls the same function from its own write path, the same way it would
call `parseTask`.

## Consequences

- `packages/core/src/prerequisites.ts` holds `checkPrerequisites`, called from `create` and
  `update` in `jsonl.ts` once each has built the task it is about to write.
- This is the first whole-store rule, not the only one there will ever be. The next one
  gets its own module beside this one, called from the same write path, rather than
  growing inside `jsonl.ts` or inside this file if the concept differs.
- The check runs only for the task whose `blockedBy` a write actually changes, not for
  every edge already in the store. A dangling pointer left by a task removed without its
  dependents being updated (dropping that pointer is a separate task) is not this write's
  problem to fail on.
