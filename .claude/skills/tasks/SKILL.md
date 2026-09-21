---
name: tasks
description: Read and update the project's task board via the `tasks` CLI. Use whenever work is planned, started, finished, or discovered — checking what to work on next, recording a new task, moving one between columns, or attaching notes and code references. Triggers on "what's next", "add a task", "mark that done", "what's in progress", "implement <n>", and on finishing any piece of work worth recording.
---

# Task board

Tasks for this project live in `.tasks/tasks.jsonl`, shared between you and the human working here. They show up on a kanban board in VSCode, so anything you change is visible immediately.

**Never read or edit `.tasks/tasks.jsonl` directly.** It is the CLI's file. Direct edits skip validation, corrupt ordering, and can interleave badly with a concurrent write. Use `tasks`.

> Every command below works. `tasks --help`, or `tasks <command> --help`, is the same
> information from the terminal. Exit codes: `0` success, `1` the request was understood but
> could not be carried out, `2` the request was malformed — worth branching on.

Task IDs are `<prefix>-<n>`, e.g. `task-tracker-7` OR `tt-7`. A bare number is shorthand for this
project's own prefix -- `tasks show 7` works the same as the qualified form. An id carrying a _different_ project's prefix will be refused.

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

`list` prints one compact line per task. `show` prints everything. Add `--json` when you need to parse the output rather than read it.

`tasks show <id> --markdown` prints the task as an editable document, and
`tasks update <id> --markdown` reads that document back from stdin. Reach for it when you are rewriting several fields at once; single changes are clearer as flags.

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

`remove` asks for confirmation on stdin by default -- pass `--force` to skip the prompt, which is what you almost always want in a non-interactive session.

`--blocked-by` also works on `add`. It replaces the whole list, same as `--refs`; `--blocked-by=` clears it. An id that does not exist, or an edge that closes a cycle (including a task blocking itself), is rejected with exit 2 — fix the id or the edge rather than retrying.

## Statuses

There are five possible statuses for a task. Each one indicates where in the lifecycle the task currently is. They are as follows:

| Column        | Means                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| `backlog`     | Not started. Where a new task lands.                                       |
| `priority`    | Identified as a candidate for the next task.                               |
| `in-progress` | Being worked on now.                                                       |
| `in-review`   | Implementation finished, waiting on a review - by a human or another agent.|
| `done`        | Finished.                                                                  | 

## When to do what

- **Starting work on something already tracked** — `tasks move <id> in-progress` first, so the
  board reflects reality while you work.
- **Finishing** — `tasks move <id> in-review`, and `tasks note` anything a future reader would
  need: the root cause, the approach taken, what you ruled out. Leave `done` for after the review
  — moving it there yourself is not your call to make.
- **Discovering something out of scope** — `tasks add` it to `backlog` and keep going. Do not
  silently expand the work you were asked to do, and do not lose the finding either. Additionally, report the finding directly to the human.
- **Learning something mid-task** — `tasks note` on the existing task. If the learning seems like something that is generally important for the project and has ramifications for many future tasks, considering adding it to the AGENTS file.

## What goes where

- **title** — one line, imperative, specific. "Fix auth redirect loop", not "auth issues".
- **notes** — reasoning, root causes, decisions, things you ruled out. Markdown, multi-line. Any notes you add here should be useful to a future reader, whether they are finishing the implementation or reviewing it. Every additional line should be potentially falsifiable. Every line should say something new, not repeat what has already been stated elsewhere in the task.
- **refs** — file paths, optionally with line ranges (`src/auth.ts:42-58`). These become
  click-to-open links on the board. If you touch additional files that are not already in the refs, add them.
- **category** — one bucket, reused across tasks. Prefer an existing one; check with
  `tasks list --json` before inventing a new one. Useful for grouping tasks by feature or work-type
- **tags** — many, for filtering. `bug`, `refactor`, `docs`, and so on.
- **blockedBy** — task ids this one is waiting on (`--blocked-by`). Display only: nothing
  refuses a status move, and it does not enforce order. Set it when the dependency is real,
  not as a way to sequence work you are about to do yourself.

## Plans

Work big enough to need a written argument gets a plan document in `docs/plans/`, numbered
`NNNN-slug.md`. `tasks init` puts a `TEMPLATE.md` there to start from.

A plan holds the reasoning: the problem, the spec, what is out of scope, the order the work goes
in. The board holds the state. Never write a task checklist into a plan, and never leave the
reasoning only in a task.

- **Before starting a task**, read any `docs/plans/...` path in its refs. That is the context the
  task was written from, and it is usually shorter than reconstructing it from the code.
- **When the work changes shape**, edit the plan and `tasks note` the task. The plan is the
  argument as it now stands; the note is what actually happened and when.
- **A superseded plan stays**, with a line at the top pointing at the plan that replaced it. Same
  habit as the ADRs.

## Rules

1. Never edit `.tasks/tasks.jsonl` by hand.
2. Never invent fields. The schema is fixed and validation will reject anything else.
3. Filter your reads. `tasks list` with no flags is rarely the right call.
4. Move a task to `in-progress` as soon as you start working on it.
5. Move a task to `in-review` when you have finished the implementation.
6. Quote task IDs when you mention a task to the human.
7. A plan document is the reasoning, the board is the state. Do not duplicate one into the
   other.
