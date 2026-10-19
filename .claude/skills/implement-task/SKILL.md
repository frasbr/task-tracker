---
name: implement-task
description: Implement a task from the board, end to end. Use when the human names a task to implement or asks for the next one. Triggers on "implement <id>", "work on <id>", "pick up <id>", "pick up the next task". Not for small edits that merely touch code a task also covers.
---

# Implementing a task

## 1. Before you write anything

`tasks show <id>`, then:

- **The plans in the refs, when the task needs them.** The notes should already carry the
  reasoning. Open the plan when they do not: the notes are thin, they name a decision without
  explaining it, or you are about to make a choice the task does not settle. Read Problem and
  Spec. Skip Approach unless the order of the work matters to you. If you had to open the plan,
  `tasks note` what the task was missing, so the next reader does not pay for it twice.
- **The project's agent guide**, `AGENTS.md` or `CLAUDE.md`, if they are not already in context. Boundaries, conventions, commands,
  definition of done. It outranks your instincts about how code should look.
- **The glossary for the area you are touching**, where the project keeps one. A new word for an
  existing concept is a bug.
- **The decision records the task touches**, where the project keeps them. A settled decision is
  not yours to reopen inside a task.

`tasks move <id> in-progress`.

If the task is blocked, ambiguous, or really two tasks, tell the human and confirm before
proceeding.

**If an orchestrator dispatched you**, there is no human to confirm with. A blocked, ambiguous
or double task goes in your report, and you stop there without writing code.

## 2. Agree the seams

A **seam** is the public boundary you test at, where behaviour is observable without reaching
inside.

Name the seams and confirm them with the human before writing a test. You cannot test
everything, so agreeing this is what puts the effort on critical paths instead of easy edges.

**If an orchestrator dispatched you**, the seams the human agreed are in your prompt. Test at
those. If they are missing, or the code shows one of them cannot work, report that and stop.
Inventing your own seams is the decision this step exists to hand to the human.

## 3. Red, then green, one slice at a time

If a `tdd` skill is installed, call it and use it instead of this section. Otherwise:

- **Failing test first.** Watch it fail for the reason you expect. A test that has never failed
  has proved nothing.
- **Then only enough code to pass it.** No speculative branches, no fields nobody asked for.
- **One seam, one test, one implementation per cycle.** Tests written in bulk verify imagined
  behaviour and lock in a structure you do not yet understand.
- **Test through the public interface.** A test that breaks under refactoring, with behaviour
  unchanged, is testing the implementation.
- **Expected values come from outside the code**: a known-good literal, a worked example, the
  spec. An assertion that recomputes the answer can never disagree with it.

## 4. Design while you go

- **One purpose per module.** A file you can no longer hold in your head is doing too much.
- **Deep over shallow.** A small interface over real work beats a wide one that forwards.
- **Never cross a written-down boundary.** If one blocks the task, stop and say so. Crossing it
  silently is worse than not doing the task.
- **Comments explain why.** Match the density around you.
- **Refactor after green.** Red is for making it work.

## 5. Prove it

Run the project's check command. Find it in the agent guide, then a `check`, `verify` or `test`
script in `package.json`, then a `Makefile` target. If nothing runs formatting and types, run
those separately.

Read the output. "Should pass" is not a result, and a failure means the task is not finished.
Quote the failure verbatim when you report it.

Then walk the agent guide's definition of done item by item. Most of it is work the code does
not cover on its own: a decision record for a changed decision, a glossary entry for a changed
term, updated docs for a changed interface.

## 6. Close it

```bash
tasks update <id> --refs=<every file you touched>
tasks note <id> "Approach, what you ruled out, anything a reviewer needs."
tasks move <id> in-review
```

`done` is the reviewer's call, not yours.

Out-of-scope findings become `backlog` tasks and one sentence to the human. Do not fold them in,
do not lose them.

## Red flags

| Thought                                       | What it means                                     |
| --------------------------------------------- | ------------------------------------------------- |
| "The tests pass, so the check will pass"      | Format and types are in the check. Run it.        |
| "I'll write the tests once it works"          | They will test what you built, not what was asked.|
| "This boundary doesn't really apply here"     | It does. Raise it instead of crossing it.         |
| "While I'm in here I'll also fix..."          | New task. Add it to `backlog` and carry on.       |
| "Close enough to done"                        | Done is a list. Check it item by item.            |
