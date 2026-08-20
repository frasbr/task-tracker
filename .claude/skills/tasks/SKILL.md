---
name: tasks
description: Read and update the project's task board via the `tasks` CLI. Use whenever work is planned, started, finished, or discovered — checking what to work on next, recording a new task, moving one between backlog/priority/in-progress/done, or attaching notes and code references. Triggers on "what's next", "add a task", "mark that done", "what's in progress", and on finishing any piece of work worth recording.
---

# Task board

Tasks for this project live in `.tasks/tasks.jsonl`, shared between you and the human working
here. They show up on a kanban board in VSCode, so anything you change is visible immediately.

**Never read or edit `.tasks/tasks.jsonl` directly.** It is the CLI's file. Direct edits skip
validation, corrupt ordering, and can interleave badly with a concurrent write. Use `tasks`.

> Every command below works. `tasks --help`, or `tasks <command> --help`, is the same
> information from the terminal. Exit codes: `0` success, `1` the request was understood but
> could not be carried out, `2` the request was malformed — worth branching on.

## Reading

Query narrowly. Listing the whole board costs tokens you will want later, and you almost never
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

Start of a work session: `tasks list --status=in-progress` then `tasks list --status=priority`.
That is usually all the context you need.

## Writing

```bash
tasks add "Fix auth redirect loop" --category=auth --tags=bug,frontend
tasks move <id> in-progress
tasks move <id> done
tasks note <id> "Root cause: redirectTo double-encoded in the callback handler."
tasks update <id> --title="..." --category=... --tags=...
tasks update <id> --refs=src/auth.ts:42-58
tasks remove <id>
```

The four statuses, in board order: `backlog`, `priority`, `in-progress`, `done`.

## When to do what

- **Starting work on something already tracked** — `tasks move <id> in-progress` first, so the
  board reflects reality while you work.
- **Finishing** — `tasks move <id> done`, and `tasks note` anything a future reader would need:
  the root cause, the approach taken, what you ruled out.
- **Discovering something out of scope** — `tasks add` it to `backlog` and keep going. Do not
  silently expand the work you were asked to do, and do not lose the finding either.
- **Learning something mid-task** — `tasks note` on the existing task. Do not create a second
  task for the same piece of work.

## What goes where

- **title** — one line, imperative, specific. "Fix auth redirect loop", not "auth issues".
- **notes** — reasoning, root causes, decisions, things you ruled out. Markdown, multi-line. This
  is where the value accumulates; be generous here.
- **refs** — file paths, optionally with line ranges (`src/auth.ts:42-58`). These become
  click-to-open links on the board, so they are worth adding whenever you touch specific code.
- **category** — one bucket, reused across tasks. Prefer an existing one; check with
  `tasks list --json` before inventing a new one.
- **tags** — many, for filtering. `bug`, `refactor`, `docs`, and so on.
- **a new task** — a genuinely separate piece of work. If it would be finished at a different
  time from the current task, it is a new task.

## Rules

1. Never edit `.tasks/tasks.jsonl` by hand.
2. Never invent fields. The schema is fixed at ten fields and validation will reject anything
   else — see PLAN.md § Data model.
3. Filter your reads. `tasks list` with no flags is rarely the right call.
4. Move a task to `in-progress` when you start it, not when you finish it. The board is a live
   picture, and the human is looking at it.
5. Quote task IDs when you mention a task to the human, so they can find the card.
