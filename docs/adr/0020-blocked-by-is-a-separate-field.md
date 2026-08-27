# `blockedBy` is a separate field, not entries in `refs`

A task waiting on another task gets its own field, `blockedBy`, a list of task ids. `refs`
was the obvious place to put this — it takes a task id today without complaint — and it was
rejected.

`refs` is validated against `REF` in `validate.ts`, a pattern built for a source pointer like
`src/auth.ts:42-58`. A task id such as `task-tracker-7` has no whitespace and no colon, so it
passes too. `tasks update <id> --refs=task-tracker-7` succeeds today and stores a value
indistinguishable from a relative path. Nothing downstream — not validation, not the
webview's rendering — can tell which meaning was intended.

`refs` is also already spoken for. Boundary 11 gives it a second job: a task cut from a plan
carries the plan's path there. A third meaning on the same field — a task dependency — makes
that join ambiguous the moment both kinds of entry sit on one task.

This does not reverse [ADR 0006](0006-ten-fixed-fields-unknown-keys-rejected.md). That ADR
says adding a field is a design decision, not an implementation detail; this is that decision
being made, not skipped.

## Consequences

- `Task` is eleven fields now. `blockedBy` is validated the same way every other field is —
  per record, with no view of the rest of the store — so only its shape is checked: each
  entry must look like a task id.
- Whether an id actually exists, and whether an edge closes a cycle, needs the whole store to
  answer and is not decided here. Until that lands, `blockedBy` accepts any id-shaped string.
