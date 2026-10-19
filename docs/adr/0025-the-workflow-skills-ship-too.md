# 0025. The workflow skills ship too

## Status

Accepted. Extends [0017](0017-the-agent-skill-ships-inside-the-binary.md).

## Context

ADR 0017 put the agent skills inside the binary so `tasks init` could install them anywhere. At
the time there were two, and both described the interface: `tasks` for the board's verbs, `plans`
for the documents its work is cut from. Neither says anything about how to work. They are a
contract, kept in step with the CLI, and `init` installing them is uncontroversial — an agent that
cannot find them does not know the CLI exists.

Two more skills then grew in this repo's `.claude/skills/`. `implement-task` takes one task end to
end: read it, agree the seams, red-green, run the project's check, walk its definition of done,
move the task to `in-review`. `implement-batch` orchestrates a nominated batch of them, one
implementer subagent per task and a separate reviewer that can close.

Those two are a different kind of thing. They encode opinions a project might not share: that
tests come first, that a reviewer is a different agent from the implementer, that two fix rounds
is the cap, that `in-review` is a real gate, that a batch commits each task on its own. Shipping them means `tasks init` stops describing an
interface and starts installing a process into every project it touches.

The alternative was leaving them here and copying them by hand. That was tried for a while and it
is what prompted this: a hand-copied workflow is a workflow that drifts, and the copies diverge
precisely where they were edited to fit a project, which is where they are hardest to merge back.

## Decision

All four skills ship inside the binary and install together. `--skip-skill` remains the way out,
and it is now all-or-nothing by design: a board with no workflow is coherent, and so is both, but
an orchestrator installed without the skill it dispatches is not.

`implement-task` installs before `implement-batch`, because the batch skill dispatches the task
skill by name.

No shipped skill may instruct an agent to run this repository's commands or assume its layout. It
finds the project's check command, its agent guide and its glossary the way an agent would. An
example that happens to carry a path or an id prefix is illustration, not instruction, and stays.
`implement-task` already worked this way; the constraint is now load-bearing, since every project
initialised gets these files.

## Consequences

`tasks init` is now opinionated about process. Someone who disagrees edits their copy, and
`installSkills` backs up a divergent file rather than overwriting it — the mechanism that made two
skills safe to reinstall is what makes four safe.

Changing a workflow skill now changes how every initialised project works, not just this one. The
definition of done already required updating `tasks` and `plans` when the CLI's interface changed;
that obligation now extends to the workflow pair whenever the lifecycle they describe changes —
a new column, a different review gate.

A project that wants the board without the process has one switch, not four.
