# The four columns are fixed, not per-project

This reverses [ADR 0019](0019-statuses-are-per-project.md). `backlog`, `priority`, `in-progress`
and `done` are the schema now, fixed as a union in `task.ts`, not a list a project's config
holds. `done` is terminal — the only one code branches on. See
[docs/plans/0003-four-static-columns.md](../plans/0003-four-static-columns.md) for the argument
in full; this is the decision record.

0019 was not wrong about the risk it named: blessing a name breaks things quietly the moment
that name can change out from under whatever depends on it. What changed is not the risk
calculus but a fact about this tool. It manages one person's local board, on one machine
([ADR 0001](0001-tasks-are-local-working-memory.md)), and that person said plainly they are not
going to rename the columns:

> I think I want to reverse this ADR. Meaning attached to specific columns adds value and as
> this tool is intended for my personal use I am unlikely to change the format anyway. It might
> be better to keep the 4 column format and have explicit meaning attached to each category.

Fixing the four removes the risk rather than accepting it — there is no rename to break anything
quietly under, because there is no rename. What the flexibility bought was a `review` column for
a project that wants one. Nothing on this machine, across every project it has tracked, ever
used it; `.tasks/config.json` in this repo has held exactly the four names since the field
existed.

The blocked-card feature was the forcing function, not the whole reason. A card reading as
blocked needs a "this prerequisite is finished" question, and 0019 is explicit that the question
cannot be asked without a name meaning something. The workaround — reading the last configured
column as terminal — is a position, not a meaning: true only until a column is added after it.

## Consequences

- `TaskStatus` is a union of the four again, off the `STATUSES` tuple in `task.ts`.
  `isTaskStatus(value)` needs no list handed to it.
- `.tasks/config.json` no longer holds `statuses`. A config still carrying the key is accepted
  only when it names exactly the four; anything else is a hard error naming the value, rather
  than a column silently stranding whatever tasks sit in it.
- `tasks status` keeps `list` — an agent running on an older skill still gets an answer instead
  of an unknown-subcommand error — and loses `add`, `rename`, `reorder`, `remove`.
- "A status that means finished," listed in AGENTS.md's Deliberately Not Built under 0019's
  reasoning, is built. `done` is terminal, and a task reads as blocked when a prerequisite's
  status is not `done`.
