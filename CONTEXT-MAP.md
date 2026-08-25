# Context map

Task Tracker is one domain, a local per-project kanban board, split across three contexts that
deliberately do not share code. Each has its own `CONTEXT.md`.

Architecture, boundaries and build commands live in [AGENTS.md](./AGENTS.md), and the reasoning
behind them in [docs/adr/](./docs/adr/). These files are the language only.

The ADRs sit in one system-wide directory rather than one per context. Most of them are about
the seams between contexts, and a small repo reads better with a single numbering.

## Contexts

- [Task Model](./packages/core/CONTEXT.md) (`packages/core/`): owns what a task is, what a
  project's columns are, and the store they live in. The other two borrow its vocabulary.
- [The `tasks` CLI](./packages/cli/CONTEXT.md) (`packages/cli/`): the verbs a person or an
  agent uses to read and change the board, and the two shapes its output takes.
- [The Board](./packages/extension/CONTEXT.md) (`packages/extension/`): how tasks are presented
  in VSCode. The board, the sidebar, and tasks opened as editor tabs.

## Relationships

- **Task Model to CLI**: the CLI is the only caller of the store. It imports core's types
  directly, so a term means the same thing on both sides.
- **CLI to Board**: the extension reaches task data only by spawning `tasks` and parsing
  `--json`. It restates the task shape as its own `BoardTask` rather than importing core
  (AGENTS.md boundary 7), so the two vocabularies are kept in step by hand.
- **Task Model to Board**: no code path. Where a term appears in both glossaries, core's
  definition is the authority and the board's entry says how it is presented.
- **CLI to agents**: `.claude/skills/tasks/SKILL.md` is the vocabulary agents are given. It
  speaks the CLI's language, and drifts from it the moment a verb changes.
