# A mechanical rewrite triggered by a write is not a whole-store rule

`remove` drops the deleted id from every other task's `blockedBy` in the same write, so a card
is never left pointing at something gone. That needs every task in the
store — the same precondition [ADR 0021](0021-whole-store-rules-live-in-core.md) used to move
`checkPrerequisites` into its own module, under boundary 12: "a rule that needs every task in
the store... lives in its own module... never inside the JSONL store."

Read literally, boundary 12 would move the drop into `prerequisites.ts` too. But `jsonl.ts`
already contains exactly this shape of thing: `renameStatus` rewrites every task carrying the
old status name, in the same write, for the same reason — and it predates boundary 12 without
being in tension with it. The two cases needed telling apart.

The difference is whether there is a question to answer. `checkPrerequisites` and its cycle
search are an algorithm: given the whole set, decide yes or no, and a SQLite `TaskStore` would
have to get that same algorithm right again, in its own terms, or risk a different answer.
Dropping a pointer decides nothing — the id is gone, so every list that named it loses that one
entry. Any store expresses that natively: `array.filter` here, `UPDATE ... SET blockedBy =
array_remove(blockedBy, ?)` in SQL. There is no logic for a shared module to hold, only a
storage-native bulk update sitting next to the write that made it necessary — which is what
`renameStatus` already does for `status`, and what `remove` now does for `blockedBy`.

A whole-store operation goes in its own module, per boundary 12, when it has to answer a
question that could be gotten wrong — existence, a cycle, anything needing real reasoning over
the set. A mechanical rewrite that follows automatically from a value disappearing — a rename,
a delete — stays inline in the store implementation, beside the write that triggers it, the way
`renameStatus` already does.

## Consequences

- `remove` in `jsonl.ts` rewrites `blockedBy` on every task in the same `map` it uses to filter
  out the deleted task, matching `renameStatus`'s shape for `status`.
- Boundary 12 in AGENTS.md is narrowed by this ADR, not reversed: it covers a rule that must
  answer a question using every task, not a bulk rewrite that a write already in progress makes
  necessary.
- The test for which side of the line a future case falls on: would a different `TaskStore`
  backend need to reimplement an algorithm to get it right, or would it express the same
  outcome as a native bulk update? The former earns a module; the latter stays with the write.
