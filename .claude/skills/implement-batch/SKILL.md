---
name: implement-batch
description: Orchestrate a batch of board tasks through implementation and review using subagents. Only ever invoked by the human, who nominates the batch — "implement 7, 9, 12", "work through 14-18", "do the priority column", "implement everything from plan 0007". Never trigger this yourself, and never use it for a single task.
disable-model-invocation: true
---

# Implementing a batch

You have been asked to orchestrate the implementation of a batch of tasks. It is your job to delegate the work to subagents, and track the status of the board until the job is finished. You should not implement code changes or review those changes yourself. Your sole responsiblity is to manage the board, the context of the change being made, and the subagents that implement and review it.

## 1. Resolve the batch

You should have been supplied a list of tasks alongside the invocation of this skill. Resolve that list into an explicit set of ids:

- `7, 9, 12` — take it as given.
- `14-18` — expand the range, then drop ids that do not exist.
- a slice — `tasks list --status=priority`, `--tag=`, `--category=`.
- a plan — `tasks list --json` and keep the tasks whose `refs` name that plan.

Ordering needs two fields the compact listing does not print, `blockedBy` and `refs`, so take
them from JSON and keep only what you need.

Do not `tasks show` every task: that pulls each
one's full notes into the context that has to survive the whole run, and the notes are the
implementer's business, not yours.

```bash
tasks list --json | jq -c 'map({id,title,status,blockedBy,refs})'
```

Narrow with `list` flags first where the batch is a slice. Without `jq`, any small filter does —
the point is that only those five fields land in your context.

Print the resolved list back to the human as ids plus titles, in the order you intend to run
them, and wait for a yes. A batch is expensive and an unnoticed wrong id is expensive twice.

If you were not given a list of tasks, or you are not sure what tasks need to be included, ask the human to clarify. Don't guess.

## 2. Order the queue

1. **`blockedBy` first.** A task runs only after everything it is blocked by is `done`. If a
   prerequisite is outside the batch and not `done`, the task does not run — say so now rather
   than discovering it at dispatch time.
2. **Then shared files.** Tasks whose `refs` overlap run adjacent, earliest first, so the second
   implementer sees the first one's code rather than a stale tree.
3. **Then the human's order.**

If two tasks in the batch block each other, the store would have rejected the cycle. If two look
like one task, say so before you start.

## 3. Agree the seams up front

`implement-task` confirms its seams with the human before writing a test, and an implementer
subagent cannot ask. So collect every task's seams first and put them to the human in one go.
That is the last question of the run; after it, the batch runs unattended.

For each task, dispatch a fresh subagent with:

- The task id, and the instruction to follow steps 1 and 2 of the `implement-task` skill only:
  read, then propose seams. No code, no tests, no board moves.
- What it must report, **under 100 words**: the seams it proposes, or why the task cannot go
  ahead — blocked, ambiguous, or really two tasks.

These only read, so they can run in parallel.

Show the human every task's seams in one message, grouped by id, plus anything reported as
unable to go ahead. Wait for a yes or corrections. A task the human drops, or one reported as
unable to go ahead and not resolved here, leaves the batch now.

Keep the agreed seams per id. They are the human's decision, not your reading of the task, so
they are the one thing besides the id you pass to an implementer.

## 4. Run each task

The tree must be clean before the first task: `git status --porcelain` prints nothing. Each task
lands as its own commit, which is what lets a reviewer see exactly one task's work.

One task at a time. One implementer subagent, then one reviewer subagent, then the next task.
Never two implementers at once: they share a working tree and will stamp on each other.

### Dispatch the implementer

A fresh general-purpose subagent per task. Never reuse one across tasks — carried-over context
is how task 9 gets implemented the way task 7 was.

The prompt gives it the task and nothing else:

- The task id, and the instruction to use the `implement-task` skill and follow it exactly.
- The seams the human agreed for that task, verbatim, and that they are confirmed.
- That it owns the whole task through to `in-review`, including moving the board itself.
- That it must run the project's check command, and report the final status line if it passes
  or the full output if it does not. A passing check is one line; nobody reads the rest.
- The ids already finished in this batch, one line each, so it does not redo their work.
- What it must report back, **under 200 words** plus that check line: what it changed, anything
  it ruled out, and anything it found that was out of scope. A longer report is not a better
  one, and you are not the reviewer — you only need enough to route the verdict.

Do not paste the plan, the diff, or your own reading of the task into the prompt. It has
`tasks show` and the repo. Your summary of a task is a worse copy of the task.

Before dispatching, record where the task starts: `git rev-parse HEAD`. When the implementer
reports, commit everything it left, whatever state it is in:

```bash
git add -A && git commit -m "<id>: <title>"
```

If it stopped without changing anything, there is nothing to commit and nothing to review: leave
the task where it is, tell the human, and move on.

### Dispatch the reviewer

A fresh subagent, always a different one from the implementer. Self-review reliably approves.

The prompt gives it:

- The fixed point: the commit the task started from, so `git diff <sha>..HEAD` is exactly that
  task's work.
- The task id, and the instruction to read it with `tasks show <id>` — including the notes the
  implementer just left.
- The instruction to use the project's `code-review` skill if one is installed, and otherwise to
  review on two axes: does the change do what the task asked, and does it follow the project's
  written standards and boundaries.
- A verdict, stated in one word at the end: **approve**, **fix**, or **reject**. Findings ranked
  worst first, each one naming a file and a line.

### Act on the verdict

- **approve** — `tasks move <id> done`, and move on.
- **fix** — `tasks move <id> in-progress`, so the board does not claim the task is under review
  while its code changes. Send the findings back to the *same implementer subagent*, which still
  has the context to act on them; it closes with `implement-task`'s last step again, which puts
  the task back in `in-review`. Commit the round as `<id>: fix round <n>`, then the same reviewer
  again, but scoped: its own findings, and `git diff HEAD~1..HEAD`, not the task's whole change a
  second time. **Two fix rounds
  maximum.** A third means the task was wrong, not the code: leave it `in-review`, note why,
  tell the human, and carry on with the rest of the batch.
- **reject** — the change does not do what the task asked, or crosses a boundary. Leave it
  `in-review`, `tasks note` the reviewer's reasoning, stop that task, and tell the human. Do not
  send a rejection back for another go.

A task that stops at `in-review` keeps its commits. Every later task builds on them, and the
human can revert the task's commits as one range if they decide against it.

Between tasks, confirm the tree is clean and the check still passes. Both lines print nothing
when all is well, so do not print the output the implementer already reported:

```bash
test -z "$(git status --porcelain)" || echo TREE DIRTY
<the project's check command> >/dev/null 2>&1 || echo CHECK FAILED
```

An implementer that left the build red poisons every task after it, and the next reviewer will
blame the wrong change.

## 5. Report

One line per task as it finishes, so the human can follow the run without reading transcripts:

```
proj-9 done — reviewer approved, 1 fix round
```

At the end: what landed, what did not and why, and the out-of-scope findings as new `backlog`
tasks with one sentence each. Findings go on the board before you report them, or they are lost.

If your context is compacted mid-batch, do not reconstruct the queue from memory. The board is
the state: the batch's ids are still `done`, `in-review` or untouched, and `tasks list` tells you
where you stopped.

## Stop the batch and ask

- A task's prerequisite is not `done` and is not in the batch.
- Two tasks in a row fail review for the same reason. The problem is upstream of the code.
- An implementer reports a boundary it could not honour.
- The check was already failing before the batch started. Fix that first; a batch on a red tree
  cannot tell you anything.
- The tree had uncommitted changes before the batch started. They would land in the first
  task's commit and its review; the human commits or stashes them first.

## Red flags

| Thought                                              | What it means                                              |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| "This fix is one line, I'll just do it"              | You are the orchestrator. Dispatch it.                     |
| "The same subagent can review its own work"          | It will approve. Always a fresh reviewer.                  |
| "I'll run these two in parallel, they look separate" | One tree, one implementer. Reorder instead.                |
| "I'll summarise the task for the subagent"           | Give it the id. Your summary loses what the task says.     |
| "Third fix round should do it"                       | Two is the cap. Escalate.                                  |
| "I'll add the out-of-scope finding to this task"     | New `backlog` task. Do not grow the batch mid-run.         |
| "The human asked for one task, but it's big"         | That is `implement-task`. This skill is human-started only.|
