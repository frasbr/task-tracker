> Superseded by [ADR 0023](0023-the-four-columns-are-fixed.md). The columns are fixed now; the
> reasoning below is kept for the record.

# Statuses are the project's own, held in config

A project's columns live in `.tasks/config.json` as an ordered list, and validation checks a
status against that list rather than against a compile-time union. The four names a fresh store
gets — `backlog`, `priority`, `in-progress`, `done` — are a default, not the schema. A repo that
works in reviews wants a `review` column; one that does not should not have to carry it.

Nothing treats a particular name as special. There is no built-in notion of "the done column",
so a feature that needs one, closed-this-week say, has to ask the question rather than hardcode
the name. The moment one name is special, renaming it breaks something quietly.

The cost was known and accepted: validation cannot be a type check any more, every caller that
validates has to be handed the project's list, and agents have to look the columns up instead of
assuming the four.

## Consequences

- `TaskStatus` is `string`, not a union. `isTaskStatus(value, statuses)` is the check, and the
  list has to be read from config first.
- A status write has to account for the tasks pointing at it, in the same atomic write. Rename
  moves its tasks; remove refuses unless told where they go. Otherwise cards end up in a column
  that no longer exists.
- The CLI's error for an unknown status lists the ones that do exist, and the agent skill teaches
  discovery through `tasks status list`. Every agent transcript in existence says `backlog`,
  `priority`, `in-progress`, `done`, so the default has to be corrected rather than assumed.
