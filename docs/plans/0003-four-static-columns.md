# 0003. Four static columns

The four column names stop being a per-project setting and become the schema. `backlog`,
`priority`, `in-progress`, `done`, fixed, with `done` meaning finished. This reverses
[ADR 0019](../adr/0019-statuses-are-per-project.md), which made them configurable, and it
deletes the machinery that decision required.

## Problem

Nothing uses the configurability, and one feature is blocked by it.

`.tasks/config.json` in this repo holds exactly the defaults:

```json
"statuses": ["backlog", "priority", "in-progress", "done"]
```

No other project on this machine has a `.tasks/` at all. The per-project status list has never
held a value other than the one it ships with.

What it costs to keep is not small. Five methods on the `TaskStore` interface
([store.ts:48-63](../../packages/core/src/store.ts#L48-L63)) — `listStatuses`, `addStatus`,
`renameStatus`, `reorderStatus`, `removeStatus` — and the ~94 lines in
[jsonl.ts](../../packages/core/src/jsonl.ts) implementing them, each with its own atomic-write
rules about what happens to the tasks sitting in a column being renamed or removed. A whole
`tasks status` verb with five subcommands
([run.ts:508-556](../../packages/cli/src/run.ts#L508-L556)). Four wrappers in the extension's
[cli.ts](../../packages/extension/src/cli.ts), the command registrations and quick-picks around
them in [extension.ts](../../packages/extension/src/extension.ts), and six entries in the
extension's `package.json`. `checkStatusList` in
[config.ts:65-96](../../packages/core/src/config.ts#L65-L96). In
[SKILL.md](../../.claude/skills/tasks/SKILL.md) it costs a whole section, plus rule 6, plus the
instruction to run `tasks status list` before doing anything else.

ADR 0019 named the price it was paying and paid it:

> validation cannot be a type check any more, every caller that validates has to be handed the
> project's list, and agents have to look the columns up instead of assuming the four.

So `TaskStatus` is `string`, `isTaskStatus(value, statuses)` needs the list passed in, and
`statuses` threads through validation, the document parser and the store — 137 references across
15 files.

The blocked one is [0002](0002-blocked-by-prerequisites.md)'s last step. A card should read as
blocked when a prerequisite is unfinished, and ADR 0019 is explicit that the question cannot be
asked:

> Nothing treats a particular name as special. There is no built-in notion of "the done column",
> so a feature that needs one, closed-this-week say, has to ask the question rather than hardcode
> the name.

The workaround is to read the last column in the configured order as terminal. That is a
position, not a meaning: it says a prerequisite is finished because of where its column sits in
a list, which stops being true the moment a column is added after it.

## Spec

Four columns, in this order, fixed at compile time:

| Column        | Meaning                                             | Branched on |
| ------------- | --------------------------------------------------- | ----------- |
| `backlog`     | Not started and not chosen. Where a new task lands. | no          |
| `priority`    | Chosen to do next. A human sorting convention.      | no          |
| `in-progress` | Being worked on now.                                | no          |
| `done`        | Finished. Terminal.                                 | yes         |

`done` is the only one code asks about, and `blockedBy` is the only thing asking: a task with at
least one prerequisite not in `done` reads as blocked. `priority` carries meaning for the person
reading the board and none for the code — it is in the table so nobody goes looking for the
branch that was never written.

`TaskStatus` is a union of the four again. `isTaskStatus(value)` takes no status list. Nothing
is handed a project's columns, because a project does not have any.

Reading:

- `tasks status list` survives and prints the four. It is what the skill teaches and what an
  agent runs first; keeping it means an agent on an older skill gets an answer instead of an
  error.
- `tasks status add|rename|reorder|remove` are gone. Each exits 2 saying the columns are fixed
  and naming the ADR, rather than reporting an unknown subcommand.

Error cases, which is where this can strand data:

- A config whose `statuses` equals the four is accepted and the key ignored. That is every
  config that exists, so nothing has to be rewritten on read.
- A config whose `statuses` is anything else is a hard error naming the offending column names.
  Not a silent drop — a `review` column quietly ignored strands every task sitting in it.
- A stored task whose `status` is not one of the four is the same hard error, naming the task id
  and the status. Same reason.
- The error text says what to do: move the tasks to one of the four and delete the key.

The board renders four columns from the constant. `.tasks/config.json` keeps `prefix` and
`nextId` and loses `statuses`.

This is hard to reverse and reverses a decision, so it supersedes ADR 0019 with a new ADR rather
than editing 0019 away. AGENTS.md loses the "A status that means 'finished'" entry from
Deliberately Not Built — it is built.

## Not in scope

- **Enforcement.** Nothing refuses to move a task from `backlog` straight to `done`, and nothing
  refuses to start a blocked one. Same position [0002](0002-blocked-by-prerequisites.md) took.
- **A `blocked` column.** Blocked is a property read off `blockedBy`, not a place a task sits.
  `packages/core/CONTEXT.md` already defines it that way.
- **Reporting.** `done` being terminal is what "closed this week" would need. Nothing here builds
  it.
- **A `started` bit.** Only `done` is branched on. Adding a second role because the first one
  worked is how the config list grew in the first place.

## Approach

The type comes first: the union in `task.ts` and `isTaskStatus` losing its parameter. Everything
downstream is then a compiler error, which is a better worklist than a search — 137 references,
and the ones that matter are indistinguishable by grep from the ones that do not.

Config is the step most likely to force a rethink, so take it before deleting anything. It is
the only part that can strand data: a status list that is not the four, or a task sitting in a
column that no longer exists. Decide what those do — the Spec says hard error, but that is worth
holding against the real config on disk before the deletions make it awkward to change.

Then delete outward from core: the five `TaskStore` methods and their JSONL implementations, then
the CLI verb, then the extension's wrappers, commands and `package.json` entries. That order
keeps the build meaningful at each step; going the other way leaves core methods nothing calls.

`SKILL.md` and the ADR land with the change that makes them true, not in a pass afterwards.

The blocked-card render is deliberately not part of this. It is already cut as its own task and
picks up the moment `done` means finished.
