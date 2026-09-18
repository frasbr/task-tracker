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
- It cuts into more than about three tasks.
- Someone could reasonably disagree with the approach.
- The reason for the order of the steps is not obvious from the steps.

If you are unsure, or believe that a plan is not needed, ask the human whether or not to continue while stating your reasoning. If the human says yes, write the plan. If the human says no, suggest an alternative next action.

## Evidence before prose

The problem section contains the substance of what the proposed change is and why it should happen. Each statement should be open to scrutiny. Therefore, it must be backed by verifiable evidence:

- File paths, with line ranges where they help.
- The actual error text, command output, or measurement. Not a paraphrase of it.
- The existing behaviour of the system, as related to the problem outlined.

Read the code before writing this section. If you cannot cite a path, you have not read enough of it yet.

## How deep the spec goes

Spec says what done looks like from outside: behaviour, interfaces, output, error cases.

Two checks on it:

- **Too vague** if a reader could not write a failing test from this section alone.
- **Too deep** if it names function signatures, types, or private structure. That is
  implementation, and it will be wrong by the time the work lands.

Write the error cases down.

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

Every task should reference the plan. Every plan should have notes that allow whoever picks it up to understand exactly what work needs to be done

Do not just restate the plan in the notes. The notes are the context needed for the task. If applicable, provide specific paragraphs or line numbers to the references so that any agent can gather only the relevant information needed for the task. In addition, the notes should contain any possible traps or pitfalls that the next person might encounter when working on the task. The goal is to ensure that the task can be completed without needing to re-read the entire plan.

If nobody could write failing tests from the information in the notes, it is too vague.

Do not add an acceptance-criteria heading. Include a brief outline of what should have changed after the task is complete. The definition of done (DOD) does not belong in a singular task, it should be found in the AGENTS.md file. If the DOD is not found, prompt the human to add it.

Never copy the task list back into the plan.

## Writing style

Technical sections — Problem, Spec, Not in scope, Approach, and task notes — are read by someone
deciding what to do next. Write so that two readers cannot come away with different work.

- **One claim per sentence.** Split any sentence joining two facts with "and" or a semicolon.
- **Name the thing.** Use the path, command, flag, status, or error text. Never "the validator",
  "the config", or "the relevant file".
- **Say what the system does, not what it should.** Present tense, active voice, a named actor:
  "`tasks add` exits 2 on an unknown status", not "an error should be returned".
- **Quantify.** Give the number, the limit, the exit code, the duration. Cut "some", "several",
  "a few", "most", "quickly", "large", "recently".
- **Ban soft modals in the spec.** No "should", "may", "could", "ideally", "probably". A behaviour
  is either required or it is not in the spec. Keep "must" only where a reader might assume
  otherwise; otherwise state the behaviour plainly.
- Every pronoun ("it", "this", "they") must have exactly one possible referent in the preceding
  sentence. If it does not, repeat the noun.
- Define a term once, then use that exact term everywhere. No synonyms for variety — a renamed
  concept reads as a second concept.
- Cut hedges ("essentially", "basically", "note that"), cut restatement of what the previous
sentence said, and cut any sentence describing the plan itself rather than the work. If a
paragraph survives deletion without the reader losing a fact, delete it.

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
6. Technical sections should adhere to the guidelines stated in the "Writing style" section.
