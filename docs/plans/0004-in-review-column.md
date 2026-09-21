> Complete as of 2026-09-19. The decision graduated to
> [ADR 0024](../adr/0024-in-review-joins-the-fixed-columns.md); the terminology moved into
> `packages/core/CONTEXT.md`; the agent-facing rules moved into
> `.claude/skills/tasks/SKILL.md`. This plan is not authoritative — read those instead.

# 0004. An in-review column

A fifth fixed column, `in-review`, sitting between `in-progress` and `done`. It means the
implementation is finished and is waiting on a review — by a human, or by another agent. This
amends [ADR 0023](../adr/0023-the-four-columns-are-fixed.md), which fixed the set at four; the
set stays fixed, it just holds five names.

## Problem

There is nowhere to put work an agent has finished but nobody has checked.

Today an agent's last move is `tasks move <id> done`, and the skill says so:
[SKILL.md:89](../../.claude/skills/tasks/SKILL.md#L89) — "**Finishing** — `tasks move <id>
done`". The board has one signal for "code exists" and it is the same signal as "this is
settled". A human opening the board sees a `done` column mixing work they reviewed with work
they have never read, and no way to tell the two apart short of reading the notes on every card.

The workaround in use is a note on the card, which nothing reads and no column count reflects.
The `/code-review` skill is the other half of the same gap: it reviews a branch, and there is no
board state that says a task is waiting for it or has been through it.

ADR 0023 argued the fifth column away on evidence that was true at the time:

> What the flexibility bought was a `review` column for a project that wants one. Nothing on
> this machine, across every project it has tracked, ever used it.

That is now the thing being asked for. 0023's actual load-bearing claim — that the columns do
not get renamed on this machine, so meaning can be attached to names — is unaffected. Adding a
name is not renaming one, and `done` keeps its meaning.

Two facts make this more than a one-line edit to the `STATUSES` tuple at
[task.ts:13](../../packages/core/src/task.ts#L13):

- This repo's own `.tasks/config.json` still carries the legacy `statuses` key holding the four
  names. `checkLegacyStatuses` at [config.ts:68-83](../../packages/core/src/config.ts#L68-L83)
  accepts that key only when `value.length === STATUSES.length` and every entry is in the set.
  Grow `STATUSES` to five and that config fails the length check — every `tasks` command in this
  repo exits with a `ConfigError` telling the user to move tasks out of a column that does not
  exist.
- `tasks help` is already stale on this subject. [help.ts:26-29](../../packages/cli/src/help.ts#L26-L29)
  still says statuses are "Per-project, held in .tasks/config.json" and to change them with
  `tasks status add|rename|reorder|remove` — subcommands 0023 deleted. Whatever is written there
  about five columns has to replace that text, not sit next to it.

## Spec

`tasks status list` prints five names in board order: `backlog`, `priority`, `in-progress`,
`in-review`, `done`. `tasks move <id> in-review` succeeds. `tasks add --status=in-review` succeeds.
`tasks list --status=in-review` filters to it.

The board renders five columns left to right in that order, `in-review` fourth. Its header reads
"In Review" — `columnLabel` at [protocol.ts:26](../../packages/extension/src/protocol.ts#L26)
derives that from the name already, and its doc comment uses this exact example. Cards drag into
and out of it like any other column. The activity-bar tree shows it as a fourth group with its
own icon.

`done` stays terminal and stays the only name code branches on. A task whose prerequisite sits in
`in-review` still reads as blocked — review is not finished. `DONE` at
[task.ts:22](../../packages/core/src/task.ts#L22) does not move.

Error cases:

- An unknown status still names all five in the message:
  `'foo' is not a status. Use one of: backlog, priority, in-progress, in-review, done.`
  ([validate.ts:141](../../packages/core/src/validate.ts#L141),
  [run.ts:693](../../packages/cli/src/run.ts#L693)).
- A `.tasks/config.json` carrying the legacy `statuses` key with the old four names is accepted
  and ignored, exactly as one carrying five would be. This is the common case — it is every
  config that exists — and it must not error.
- A legacy `statuses` key naming something that is not a subset of the five is still a hard error
  naming the value, unchanged in intent.

## Not in scope

- Any automation that moves a task into or out of `in-review`. Agents move it by hand, per the
  skill.
- Wiring `/code-review` to the board. Separate work, and it wants this column to exist first.
- Reopening per-project columns. The set is fixed at five; [ADR 0023](../adr/0023-the-four-columns-are-fixed.md)'s
  reasoning holds and the new ADR amends rather than reverses it.
- A `rejected` or `changes-requested` column. A failed review moves the card back to
  `in-progress`, which is what that means.

## Approach

The config check comes first, before `STATUSES` grows. It is the step that turns a green repo
red: the moment the tuple has five entries, this repo's own board stops answering. Loosen
`checkLegacyStatuses` to accept any subset of the fixed names rather than an exact-length match
— the key is ignored either way, and its only job is to catch a column name that no longer
exists. Then grow the tuple.

After that it is mechanical and falls out of the type system. `TaskStatus` is a union off the
tuple, so `npm run typecheck` names every exhaustive switch that needs a fifth arm. The places
types will not reach are the ones to check by hand: the per-column accent colours in
[board.css:267-277](../../packages/extension/media/board.css#L267-L277), the icon table at
[tasks-tree.ts:35-40](../../packages/extension/src/tasks-tree.ts#L35-L40), which has a fallback
so a missing entry is silent, and the board's grid, which is `grid-auto-columns: minmax(240px,
1fr)` at [board.css:111-112](../../packages/extension/media/board.css#L111-L112) — five columns
at a 240px floor is 1200px before gaps, so check what a narrow editor pane does.

The step most likely to force a rethink is the tree's expand heuristic at
[tasks-tree.ts:111-115](../../packages/extension/src/tasks-tree.ts#L111-L115), which collapses
the first and last column and expands the middle. With five that expands `priority`,
`in-progress` and `in-review`. That may be right or may be noise; decide it by looking at it.

Documentation lands with the code rather than after it, because the skill is what agents actually
read: the status table at [SKILL.md:71-76](../../.claude/skills/tasks/SKILL.md#L71-L76), the
finishing-work line at :89, rule 6 at :142, and the stale `tasks help` text. The ADR is written
at the end, once the shape is known.
