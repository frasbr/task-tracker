---
name: tasks
description: Read and update the project's task board via the `tasks` CLI. Use whenever work is planned, started, finished, or discovered — checking what to work on next, recording a new task, moving one between columns, or attaching notes and code references. Triggers on "what's next", "add a task", "mark that done", "what's in progress", and on finishing any piece of work worth recording.
---

# Task board

Tasks for this project live in `.tasks/tasks.jsonl`, shared between you and the human working
here. They show up on a kanban board in VSCode, so anything you change is visible immediately.

**Never read or edit `.tasks/tasks.jsonl` directly.** It is the CLI's file. Direct edits skip
validation, corrupt ordering, and can interleave badly with a concurrent write. Use `tasks`.

> Every command below works. `tasks --help`, or `tasks <command> --help`, is the same
> information from the terminal. Exit codes: `0` success, `1` the request was understood but
> could not be carried out, `2` the request was malformed — worth branching on.

Task IDs are `<prefix>-<n>`, e.g. `task-tracker-7` OR `tt-7`. A bare number is shorthand for this
project's own prefix -- `tasks show 7` works the same as the qualified form. An id carrying a
_different_ project's prefix is refused rather than guessed at, which usually means it was
pasted from another repo.

## Reading

Query narrowly. Listing the whole board costs tokens, and you almost never
need every task.

```bash
tasks list --status=priority             # what to pick up next
tasks list --status=in-progress          # what is already underway
tasks list --tag=bug --status=backlog    # a slice
tasks list --category=auth
tasks show <id>                          # one task in full, including notes and refs
```

`list` prints one compact line per task. `show` prints everything. Add `--json` when you need to
parse the output rather than read it.

`tasks show <id> --markdown` prints the task as an editable document, and
`tasks update <id> --markdown` reads that document back from stdin. Reach for it when you are
rewriting several fields at once; single changes are clearer as flags.

Start of a work session: run `tasks status list` first, so you use this project's real column
names, then `tasks list --status=in-progress` and `tasks list --status=priority`. That is
usually all the context you need.

## Writing

```bash
tasks add "Fix auth redirect loop" --category=auth --tags=bug,frontend
tasks move <id> in-progress
tasks move <id> done
tasks note <id> "Root cause: redirectTo double-encoded in the callback handler."
tasks update <id> --title="..." --category=... --tags=...
tasks update <id> --refs=src/auth.ts:42-58
tasks update <id> --blocked-by=<id>,<id>
tasks remove <id> --force
```

`remove` asks for confirmation on stdin by default -- pass `--force` to skip the prompt, which is
what you almost always want in a non-interactive session.

`--blocked-by` also works on `add`. It replaces the whole list, same as `--refs`; `--blocked-by=`
clears it. An id that does not exist, or an edge that closes a cycle (including a task blocking
itself), is rejected with exit 2 — fix the id or the edge rather than retrying.

## Statuses

Statuses are **per-project**, not a fixed set. Look them up; do not assume them. A fresh project
starts with `backlog`, `priority`, `in-progress`, `done`, but any project can rename, reorder,
add, or remove columns — so the names above are a starting point, not the schema.

```bash
tasks status list                        # this project's columns, in board order
tasks status add review --after=in-progress
tasks status rename priority next-up     # moves the tasks in it too, in one write
tasks status reorder review --before=done
tasks status remove review --move-to=backlog   # --move-to required if the column has tasks
```

Run `tasks status list` at the start of a session. If a `move` or an `add --status=` is rejected
with "not a status", that is the CLI telling you the column does not exist here — read the list
it prints and use a real name, or add the column deliberately with `tasks status add`. Do not
invent a column by writing a status the project does not have.

## When to do what

- **Starting work on something already tracked** — `tasks move <id> in-progress` first, so the
  board reflects reality while you work.
- **Finishing** — `tasks move <id> done`, and `tasks note` anything a future reader would need:
  the root cause, the approach taken, what you ruled out.
- **Discovering something out of scope** — `tasks add` it to `backlog` and keep going. Do not
  silently expand the work you were asked to do, and do not lose the finding either.
- **Learning something mid-task** — `tasks note` on the existing task. Do not create a second
  task for the same piece of work. If the learning seems like something that is generally important for the project and has ramifications for many future tasks, considering adding it to the AGENTS file.

## What goes where

- **title** — one line, imperative, specific. "Fix auth redirect loop", not "auth issues".
- **notes** — reasoning, root causes, decisions, things you ruled out. Markdown, multi-line. This
  is where the value accumulates; be generous here while keeping to concise, technical language.
  The notes should contain enough information/context to give someone new a solid foundation for completing the task.
- **refs** — file paths, optionally with line ranges (`src/auth.ts:42-58`). These become
  click-to-open links on the board.
  During planning these should be added when you feel specific files will be relevant for understanding the task.
  During implementation these should be added when you touch specific code.
- **category** — one bucket, reused across tasks. Prefer an existing one; check with
  `tasks list --json` before inventing a new one. Useful for grouping tasks by feature or work-type
- **tags** — many, for filtering. `bug`, `refactor`, `docs`, and so on.
- **blockedBy** — task ids this one is waiting on (`--blocked-by`). Display only: nothing
  refuses a status move, and it does not enforce order. Set it when the dependency is real,
  not as a way to sequence work you are about to do yourself.
- **a new task** — a genuinely separate piece of work. If it would be finished at a different
  time from the current task, it is a new task.

## Plans

Work big enough to need a written argument gets a plan document in `docs/plans/`, numbered
`NNNN-slug.md`. `tasks init` puts a `TEMPLATE.md` there to start from.

A plan holds the reasoning: the problem, the spec, what is out of scope, the order the work goes
in. The board holds the state. Never write a task checklist into a plan, and never leave the
reasoning only in a task.

- **Before starting a task**, read any `docs/plans/...` path in its refs. That is the context the
  task was written from, and it is usually shorter than reconstructing it from the code.
- **When you cut tasks from a plan**, put the plan's path in the refs of every one of them:
  `tasks add "..." --refs=docs/plans/0003-blocked-status.md,packages/core/src/task.ts`.
- **When the work changes shape**, edit the plan and `tasks note` the task. The plan is the
  argument as it now stands; the note is what actually happened and when.
- **A superseded plan stays**, with a line at the top pointing at the plan that replaced it. Same
  habit as the ADRs.

## Rules

1. Never edit `.tasks/tasks.jsonl` by hand.
2. Never invent fields. The schema is fixed at eleven fields and validation will reject anything
   else.
3. Filter your reads. `tasks list` with no flags is rarely the right call.
4. Move a task to `in-progress` when you start it, not when you finish it. The board is a live
   picture, multiple actors might be working on it simultaneously, and the human is tracking it.
5. Quote task IDs when you mention a task to the human, so they can find the card.
6. Look up statuses with `tasks status list`; never assume the four defaults, and never write a
   status the project does not have. Change columns only through `tasks status`.
7. A plan document is the reasoning, the board is the state. Do not duplicate one into the
   other.
