# The `tasks` CLI

The verbs people and agents use to read and change a board, and the two shapes the answers come
back in. Sole writer of the store.

Task, status, rank, category, tag and ref are defined in the
[Task Model](../core/CONTEXT.md) and mean the same thing here. This glossary covers only what
the command line adds.

## Language

**Command**:
A top-level verb. `add`, `list`, `show`, `update`, `move`, `note`, `remove`, `init`, `status`,
`migrate-ids`. The unit a user types and a help topic exists for.
_Avoid_: action, operation, subcommand, which means something narrower below

**Subcommand**:
A verb underneath `status`: `list`, `add`, `rename`, `reorder`, `remove`. The only place the
CLI nests.
_Avoid_: sub-verb, mode

**Compact output**:
The default. One line per task, padded into columns, meant to be read by a person scanning a
terminal or an agent spending tokens. Stays one line per task so it pipes into `grep`.
_Avoid_: human output, pretty output, plain output

**JSON output**:
What `--json` produces. The machine path, and the contract the extension reads. A different
answer to the same question, not a pretty-printed version of the compact form.
_Avoid_: machine mode, raw output, API output

**Markdown mode**:
`show --markdown` and `update --markdown`, reading and writing a task as a task document
through stdout and stdin. The route the editor's task tabs travel.
_Avoid_: doc mode, edit mode

**Bare number**:
An id given as just its number, as in `tasks show 7`, resolved against the current project's
prefix. An id carrying a different project's prefix is refused rather than guessed at.
_Avoid_: short id, unqualified id

**Store discovery**:
Walking up from the working directory until a `.tasks/` appears, the way git finds its repo. Why
no command needs a configured path, and why `-C` is the only way to point somewhere else.
_Avoid_: resolution, lookup, root finding

**Agent skill**:
Instructions that teach an agent to use this CLI, compiled into the binary and installed to the
user's home directory by `tasks init`. Teaches using the tool, not building it. There are four,
in two pairs: `tasks` and `plans` for the interface — the board, and the documents its work is
cut from — and `implement-task` and `implement-batch` for the workflow run on top of it.
_Avoid_: prompt, plugin, docs, instructions

**Init**:
Setting a project up. Creating `.tasks/`, choosing the prefix, scaffolding `docs/plans/`, and
installing the agent skill. The one command that writes outside the project, which it says when
it does.
_Avoid_: setup, bootstrap, install

**Plan**:
A numbered document under `docs/plans/` holding the argument behind a piece of work: the
problem, the spec, what is out of scope, and the order the steps go in. Holds no progress — a
task's `refs` point back at its plan, and the board is what says where the work has got to.
_Avoid_: spec (a section inside a plan, not the whole thing), design doc, roadmap

**Workflow skill**:
An agent skill that teaches how work moves rather than what the CLI does: `implement-task` for
one task, `implement-batch` for a nominated batch dispatched to subagents. Opinionated where an
interface skill is descriptive, and shipped anyway (ADR 0025).
_Avoid_: process skill, orchestration skill

**Plan template**:
The `TEMPLATE.md` that `init` writes into `docs/plans/`. A starting point a project is meant to
edit, unlike the agent skill, which is a contract kept in step with the CLI.
_Avoid_: scaffold, boilerplate, skeleton
