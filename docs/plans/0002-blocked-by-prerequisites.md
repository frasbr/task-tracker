# 0002. Prerequisites between tasks

An eleventh field on `Task`: `blockedBy`, a list of task ids this task waits on. Display
only — the board renders a blocked card differently, and nothing refuses to move it. This is
wishlist item 1, which asked whether prerequisites could just be references to other task ids.
They cannot, and the reason is the whole first half of this plan.

## Problem

There is nowhere to write down that one task waits on another. `Task` is ten fields
([task.ts](../../packages/core/src/task.ts)) and none of them holds a relationship.

The obvious place to put one is `refs`, and `refs` will take it. The validator is

```
const REF = /^[^\s:][^:]*(?::\d+(?:-\d+)?)?$/;
```

at [validate.ts:42](../../packages/core/src/validate.ts#L42). A task id — `task-tracker-7` —
has no whitespace and no colon, so it passes. `tasks edit task-tracker-9 --refs=task-tracker-7`
succeeds today and stores a value that is indistinguishable from a relative file path. Nothing
downstream can tell the two apart: the webview renders every entry through the same
`renderRefs` at [main.ts:316](../../packages/extension/src/webview/main.ts#L316).

`refs` is also spent. Boundary 11 in [AGENTS.md](../../AGENTS.md) gives it a meaning already —
a task cut from a plan carries the plan's path there. A second meaning on the same field makes
that join ambiguous the moment both are present.

The remaining option today is prose in `notes`, which no query and no card can read.

One constraint shapes everything below. Validation in core is per-record and stateless:
`parseTask` takes one record, a label and a prefix, and has no view of the other tasks in the
store. Every rule in the Spec below — does that id exist, does this edge close a cycle — needs
the whole task set. None of them can live where the current validation lives.

## Spec

A task carries a list of ids it waits on. The list is order-insensitive and deduplicated, the
same way `refs` is.

Setting it:

- Set the list on create and replace it on edit, by flag, alongside the existing field flags.
- The list appears in `--json` output and in `tasks show`.
- An empty list is the default and is valid.

Rejected at write time, exit code 2:

- An id not present in the store. The message names the id that was not found.
- An edge that closes a cycle, including a task blocking itself. The message names the cycle.
- A malformed id — anything that is not a task id shape.

Not rejected:

- Deleting a task that others wait on. The delete succeeds, and every pointer to the deleted id
  is dropped from the tasks that held it, in the same write. No warning. A task that loses its
  last prerequisite this way is simply no longer blocked.
- Moving a blocked task to any status. Nothing about this field constrains a move.

On the board, a task with at least one prerequisite still in a non-terminal state reads as
blocked. A task whose prerequisites are all elsewhere reads normally.

## Not in scope

- **Enforcement.** Nothing refuses a status move. If that is wanted later it is a second
  decision, and it collides with there being no status that means "finished"
  ([ADR 0019](../adr/0019-statuses-are-per-project.md)).
- **Hierarchy.** This is a peer edge, not subtasks. Subtasks stay in Deliberately Not Built.
- **Querying the graph.** No `--unblocked` filter, no topological sort, no "what does this
  block" reverse lookup. Add one when a board is big enough to need it.
- **Cross-project edges.** Ids are prefixed and would make this possible. Nothing here builds
  for it.

## Approach

The field and its shape validation come first, because the type is what everything else is
written against: the eleventh entry in `TASK_FIELDS`, an id-shaped check, dedupe on the way in.
That step is mechanical and touches nothing that can argue back.

The second step is the one most likely to force a rethink, so take it before the surface work.
Existence and cycle checks need every task, and today nothing in core has both a validator's job
and the store's view. Either a seam appears in core for whole-store rules, or the checks go into
the JSONL store beside the writes that already read the full file. That choice is worth making
deliberately and worth an ADR if it lands as a new seam, because every later whole-store rule
will follow it.

Dropping pointers on delete is cheap once that is settled and should ride along with it.
`remove` at [jsonl.ts:133](../../packages/core/src/jsonl.ts#L133) already reads every task and
rewrites the whole file; the drop is a `map` beside the existing `filter`. `renameStatus` is the
precedent — it rewrites every task carrying the old name in the same write, for the same reason,
so a card is never left pointing at something gone.

Surface work comes last and in this order: the task document header, then the CLI flags and
`--json`, then the extension. The extension is last because `BoardTask` in `protocol.ts` is
copied by hand across boundary 2, and copying a shape that is still moving means copying it
twice.

The decision to make this a separate field rather than overloading `refs` graduates to an ADR
when the first step lands.

## Open questions

- Does the upstream card show anything? A blocked card obviously reads as blocked. Whether the
  task doing the blocking says so too is a board decision, and only the reader of the board can
  make it.
