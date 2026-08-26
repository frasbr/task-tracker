---
name: plans
description: Write a plan document for a piece of work before cutting tasks from it. Use when work needs its argument written down first — a feature spanning more than one session, a refactor whose order matters, or an approach someone could reasonably disagree with. Triggers on "write a plan", "plan this out", "spec this out", "how should we approach", and before adding more than a handful of related tasks to the board.
---

# Writing a plan

Plans live in `docs/plans/NNNN-slug.md`, numbered flat like ADRs. `docs/plans/TEMPLATE.md` is the
starting point, written there by `tasks init`.

A plan is the argument behind a piece of work. The board is that work's state. The `tasks` skill
covers the seam between the two; this skill covers the writing.

## Does this work need a plan?

Write one when any of these is true:

- The work spans more than one session.
- It cuts into more than about four tasks.
- Someone could reasonably disagree with the approach.
- The reason for the order of the steps is not obvious from the steps.

Otherwise write the tasks and start. A plan for work that did not need one is a file nobody
reads, and it costs every later reader the time it takes to decide it does not matter.

Unsure? Write the Problem section and stop. If it comes out as one obvious sentence, there is no
plan to write. Put the sentence in the task's notes and get on with it.

## Evidence before prose

Problem is the load-bearing section. It must hold things a reader can check:

- File paths, with line ranges where they help.
- The actual error text, command output, or measurement. Not a paraphrase of it.
- What happens today, stated as behaviour rather than as a feeling about the code.

A Problem section with no checkable facts is a wish. Nobody can argue with it, so review of the
plan collapses into agreeing with its tone.

Read the code before writing this section. If you cannot cite a path, you have not read enough
of it yet.

## How deep the spec goes

Spec says what done looks like from outside: behaviour, interfaces, output, error cases.

Two checks on it:

- **Too vague** if a reader could not write a failing test from this section alone.
- **Too deep** if it names function signatures, types, or private structure. That is
  implementation, and it will be wrong by the time the work lands.

Write the error cases down. They are where specs go quiet, and where what gets built diverges
from what was wanted.

## Cutting tasks is part of writing the plan

The plan is not done when the prose reads well. It is done when you can cut tasks from it, so cut
them in the same sitting:

```bash
tasks add "Reject an unknown status with exit 2" \
  --refs=docs/plans/0003-blocked-status.md,packages/core/src/validate.ts \
  --category=validation \
  --notes="Statuses are per-project (ADR 0019), so the valid set comes from config,
not from a constant. checkStatus at validate.ts:118 already takes the list — this is
about the exit code, which must be 2 and not 1. Name the unknown status and list the
valid ones in the message."
```

Every task from the plan carries the plan's path in its refs, and every one carries notes.

The plan being in refs is not a reason to leave the notes empty. It is the reason they are
short. A plan is long and the task needs one part of it: which paragraph applies here, what
you found in the code while cutting this task, and the trap the next person would otherwise
walk into. Write that down while you still have it — you have just read the code, and that
context is gone by the time anyone picks the task up.

A task whose notes only restate its title is not cut yet.

Say what will be observably different when the task is done, in a sentence, in the notes. The
same bar the Spec section is held to applies here: if nobody could write a failing test from
what you wrote, it is too vague. Do not add an acceptance-criteria heading — the sentence
belongs in the notes, and a heading only invites restating the title under it. AGENTS.md holds
the definition of done, which is about whether a change is fit to land and is the same for every
task. This is the other question: whether it was the right thing to build.

The cut is a test of the Approach section. A task you cannot state in one imperative line without
re-reading the plan means the section is too vague. Fix the plan rather than writing the vague
task.

Never copy the task list back into the plan. Two copies of a checklist means one of them is lying
inside a day.

## What leaves the plan, and where it goes

A plan is temporary by design. As the work lands, its durable parts move out:

| What                                        | Where it goes                  |
| ------------------------------------------- | ------------------------------ |
| A decision that is hard to reverse          | an ADR in `docs/adr/`          |
| A term that gained or changed meaning       | the relevant `CONTEXT.md`      |
| A rule future work has to follow            | `AGENTS.md`                    |
| Still true, not yet built                   | stays in the plan              |

Move each part as the work lands, not in a cleanup pass later. This is the reason plans are per
feature rather than per project: a single project-wide `PLAN.md` grows past 30KB, most of its
sections quietly migrate to the files above, and what is left is a husk that still reads as
authoritative.

## When the work lands

Graduate the durable parts using the table above, then freeze the plan: a note at the top saying
it is complete, dated, not authoritative, and where its content went. Do not delete it and do not
keep editing it. A frozen plan is the record of how something was argued into existence, which is
the one thing the code cannot show you.

## When the plan turns out to be wrong

Edit the plan, then `tasks note` the task. The plan is the argument as it now stands; the note is
what actually happened, and when.

When the shape changes enough that the old argument no longer holds, write a new plan and put one
line at the top of the old one pointing at it. Same habit as the ADRs. Do not delete a superseded
plan; the reasoning behind a wrong turn is often the most useful thing in the directory.

## Rules

1. No task list and no progress inside a plan. The board holds state.
2. No Problem section without checkable facts in it.
3. Cut the tasks before calling the plan done. Every one carries the plan's path in its
   refs and enough notes to start on without re-reading the plan.
4. A hard-to-reverse decision graduates to an ADR. Link it from the plan rather than restating it.
5. Delete any section you have nothing to say in. A short true plan beats a padded complete one.
