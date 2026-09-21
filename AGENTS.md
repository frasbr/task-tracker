# AGENTS.md

Guidance for coding agents working in this repo. Read this before writing code. It is the source
of truth for architecture and the data model.

---

## Task Tracker

Task-tracker is a tool for creating and managing local, per-project kanban boards. The purpose is to align humans and coding agents on the work being done within a project.

Three parts: a **core library** that owns the data, a **CLI** that is the only thing allowed to
touch the store, and a **VSCode extension** that renders a board by shelling out to that CLI.

- **Every mutation goes through the CLI.** The webview asks the host, the host spawns `tasks`.
  Do not let the webview hold authoritative state — it renders what the store says. Filtering and
  sorting are the exception that proves it: they are view state, they belong in the webview, and
  they must survive a re-render rather than being written anywhere.
- **Watcher thrash.** The board's own writes retrigger its watcher. A render arriving mid-drag is
  deferred until the drag ends; keep that guard when you touch the render path.

To try it: press F5, or run the "Run the Task Tracker extension" launch configuration. That opens
a development host; run `Task Tracker: Open Board` in it with a project folder open.

## Vocabulary

[CONTEXT-MAP.md](CONTEXT-MAP.md) points at a `CONTEXT.md` per package. Each one is a glossary
and nothing more. What a term means, and which word to use when several are available. Read the
one for the package you are working in before you name anything new. Architecture goes here, not
there.

## Commands

```bash
npm install          # once
npm run check        # format check + typecheck + tests — run this before you call anything done
npm run build        # bundle the CLI and the extension
npm test             # tests only
npm run typecheck    # types only
npm run format       # rewrite files with prettier
```

Per-package: `npm run <script> -w @task-tracker/core` (or `-w @task-tracker/cli`,
`-w task-tracker-vscode`).

To try the CLI while building it: `node packages/cli/dist/tasks.js <args>` after `npm run build`,
or `npm run watch -w @task-tracker/cli` for a rebuild loop.

## Repo map

This map lists the key directories and their purpose. To be used as a rough guide to the codebase.

When adding to or updating this map:

- do not list or describe specific files
- avoid describing specific boundaries - add those instead to the boundaries section below

- **`packages/core/`** — the data model and the store behind it: the `Task` shape, validation,
  whole-store rules like `blockedBy` integrity, fractional ranks, ID minting, per-project
  config, and the JSONL implementation of `TaskStore`. Holds no opinion about terminals or
  editors. Boundaries 1, 5 and 12.
- **`packages/cli/`** — the `tasks` binary: flag parsing, every verb, and two output modes
  (compact lines, and `--json`). Sole writer of the store, and its `--json` output is the contract
  the extension reads. The agent skill is bundled into the binary from here.
  Boundaries 1 and 8; exit codes under Conventions.
- **`packages/extension/`** — the VSCode extension: the webview board, the activity-bar list,
  tasks-as-editor-tabs, and the watcher that keeps them in step. Reaches task data only by
  spawning the CLI. `src/webview/` is the browser half — board UI, no Node APIs — and `media/`
  holds its CSS and icons. Boundaries 2, 3, 4, 7 and 9.
- **`bin/`** — the installers. `install-cli` puts a standalone `tasks` on the PATH;
  `install-extension` builds, packages and installs the board (`--status` / `--uninstall` /
  `--dev`, and `VSCODE_EXTENSIONS_DIR` redirects it, which is how it is tested safely).
  `npm run install-all` runs both.
- **`.claude/skills/tasks/`** and **`.claude/skills/plans/`** — the two skills that teach agents
  to _use_ the tool, not to build it. `tasks` covers the board, `plans` covers writing the
  documents its work is cut from. Both are compiled into the `tasks` binary and installed by
  `tasks init`. Boundary 10.
- **`.tasks/`** — this repo's own board, kept by the tool itself.
- **`docs/adr/`** — why the architecture is the shape it is. Numbered, short, and appended to
  rather than rewritten.
- **`docs/plans/`** — the argument behind a piece of work before it exists: problem, spec, what
  is out of scope, and the order the steps go in. One numbered file per feature, flat.
  `TEMPLATE.md` here is the master copy of what `tasks init` writes into other projects.
  Boundary 11.
- **`CONTEXT-MAP.md`** and the `CONTEXT.md` beside each package — the project's language.
  Glossaries, with no implementation detail in them. See Vocabulary above.
- **`AGENTS.md`** — this file. How to work here, and the source of truth for architecture and
  data-model decisions.

---

## Stack decisions

Each has an ADR recording why. Change one only with a stated reason, and supersede its ADR when
you do.

| Choice     | What                                                                                  | ADR                                                        |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Language   | TypeScript, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` | [0012](docs/adr/0012-typescript-run-directly-on-node.md)   |
| Runtime    | Node ≥ 22.18, running `.ts` with no transform step                                    | [0012](docs/adr/0012-typescript-run-directly-on-node.md)   |
| Packages   | npm workspaces                                                                        | [0013](docs/adr/0013-npm-workspaces-over-pnpm.md)          |
| Build      | esbuild, for the two shipped bundles only                                             | [0012](docs/adr/0012-typescript-run-directly-on-node.md)   |
| Tests      | `node --test`                                                                         | [0016](docs/adr/0016-zero-runtime-dependencies.md)         |
| Lint       | none — Prettier only                                                                  | [0014](docs/adr/0014-prettier-only-no-eslint.md)           |
| Webview UI | vanilla TS                                                                            | [0015](docs/adr/0015-vanilla-typescript-in-the-webview.md) |
| Deps       | zero at runtime                                                                       | [0016](docs/adr/0016-zero-runtime-dependencies.md)         |

---

## Boundaries that must not be crossed

These are the architecture. Violating one silently is worse than not doing the task. The rule is
here. The argument for it is in the linked ADR.

1. **Only `@task-tracker/core` touches the store.** No other package reads or writes
   `.tasks/tasks.jsonl`. Not the CLI directly, not the extension, not a test helper.
   ([ADR 0002](docs/adr/0002-core-owns-the-store-behind-an-interface.md))

2. **The extension never imports `@task-tracker/core`.** It reaches task data only by spawning the
   CLI and parsing `--json` output. If you find yourself adding core to the extension's
   dependencies, stop. ([ADR 0004](docs/adr/0004-the-extension-shells-out-to-the-cli.md))

3. **The extension host holds no task logic.** No parsing, no validation, no rank arithmetic. It
   spawns, marshals, watches, and renders. Logic belongs in core.
   ([ADR 0004](docs/adr/0004-the-extension-shells-out-to-the-cli.md))

4. **The webview has no filesystem or Node access.** It talks to the host over `postMessage` and
   nothing else. Every mutation is a request to the host, which spawns the CLI.
   ([ADR 0003](docs/adr/0003-the-cli-is-the-only-writer.md),
   [0004](docs/adr/0004-the-extension-shells-out-to-the-cli.md))

5. **Callers depend on the `TaskStore` interface, never a concrete store.** The JSONL
   implementation is an implementation detail.
   ([ADR 0002](docs/adr/0002-core-owns-the-store-behind-an-interface.md))

6. **Unknown fields are rejected, loudly.** Validation must fail on keys it does not recognise
   rather than storing them. Agents will invent plausible-looking fields; the schema is the
   defence. A task is eleven fields today; adding a twelfth is a design decision, not a
   tidy-up. ([ADR 0006](docs/adr/0006-ten-fixed-fields-unknown-keys-rejected.md))

7. **`BoardTask` in `protocol.ts` is a deliberate duplicate of the core `Task` type.** Do not
   "fix" the duplication by importing core — that is boundary 2, and the duplication is its
   visible price. When the CLI's JSON changes, change this by hand.
   ([ADR 0004](docs/adr/0004-the-extension-shells-out-to-the-cli.md))

8. **Anything writing outside the project must say so.** `tasks init` installs a skill into
   `~/.claude/skills`. Tests must redirect that with `CLAUDE_SKILLS_DIR` — a test run wrote
   into a real home directory once, before `run.test.ts` isolated it.
   ([ADR 0017](docs/adr/0017-the-agent-skill-ships-inside-the-binary.md))

9. **The extension package must not declare `"type": "module"`.** The
   MODULE_TYPELESS_PACKAGE_JSON warning from `node --test` is the correct trade and must not be
   silenced that way. ([ADR 0005](docs/adr/0005-the-extension-bundle-stays-commonjs.md))

10. **`.claude/skills/tasks/` and `.claude/skills/plans/` are the master copies of the agent
    skills.** Edit them there, never in `~/.claude/skills` — an edit made in the installed
    location is silently overwritten on the next install. Adding a third means adding it to the
    `SKILLS` list in `skill.ts`; nothing discovers them from disk.
    ([ADR 0017](docs/adr/0017-the-agent-skill-ships-inside-the-binary.md),
    [0018](docs/adr/0018-plans-live-in-a-numbered-directory.md))

11. **A plan holds the reasoning, the board holds the state.** No task checklists and no
    progress in `docs/plans/`; no reasoning that lives only in a task. The two are joined by
    `refs` — a task cut from a plan carries the plan's path. `docs/plans/TEMPLATE.md` is the
    master copy shipped by `tasks init`, so editing it changes what every other project gets.
    ([ADR 0018](docs/adr/0018-plans-live-in-a-numbered-directory.md))

12. **A rule that needs every task in the store, not just the one being written, lives in its
    own module in `packages/core/src/`, never inside the JSONL store.** `jsonl.ts` calls it
    from the write path; a future `TaskStore` implementation calls the same module. This
    covers a rule that has to answer a question over the whole set — existence, a cycle — not
    a mechanical rewrite that a write already in progress makes necessary, such as `remove`
    dropping a deleted id from every `blockedBy`; that stays inline, beside the write that
    triggers it.
    ([ADR 0021](docs/adr/0021-whole-store-rules-live-in-core.md),
    [0022](docs/adr/0022-mechanical-rewrites-stay-with-their-write.md))

---

## Decisions

The rules above are the enforceable half. [`docs/adr/`](docs/adr/) holds the reasoning, and the
data-model decisions that have no boundary to enforce them.

- [0007](docs/adr/0007-fractional-base62-ranks.md) fractional ranks
- [0008](docs/adr/0008-task-ids-are-prefix-and-counter.md) id minting
- [0009](docs/adr/0009-tasks-open-as-editor-tabs-not-files.md) tasks as editor tabs
- [0010](docs/adr/0010-task-documents-are-not-yaml.md) the task document format
- [0011](docs/adr/0011-filter-and-sort-are-view-state.md) filter and sort as view state
- [0018](docs/adr/0018-plans-live-in-a-numbered-directory.md) plans as numbered documents
- [0019](docs/adr/0019-statuses-are-per-project.md) statuses as project config — superseded by
  0023
- [0020](docs/adr/0020-blocked-by-is-a-separate-field.md) `blockedBy` as its own field
- [0021](docs/adr/0021-whole-store-rules-live-in-core.md) whole-store rules as their own core
  module
- [0022](docs/adr/0022-mechanical-rewrites-stay-with-their-write.md) mechanical rewrites stay
  with their write
- [0023](docs/adr/0023-the-four-columns-are-fixed.md) the four columns are fixed, superseding
  0019
- [0024](docs/adr/0024-in-review-joins-the-fixed-columns.md) `in-review` joins the fixed columns,
  amending 0023

Start at [0001](docs/adr/0001-tasks-are-local-working-memory.md). Tasks are one person's local
working memory, and every other decision assumes it.

Add an ADR when a decision is hard to reverse, would look surprising without the context, and
came out of a real trade-off. Missing any of those three, it belongs in a code comment
instead.

---

## Conventions

- **Imports use explicit `.ts` extensions** (`import { Task } from './task.ts'`). Node's type
  stripping requires it and `allowImportingTsExtensions` is on for exactly this reason.
- **Type-only imports use `import type`.** `verbatimModuleSyntax` is on; it will error otherwise.
- **Tests live next to their subject** as `*.test.ts` and run under `node --test`.
- **Comments explain why, not what.** The skeleton files model the density expected — a header
  block on a module explaining its role, and near-silence elsewhere.
- **Errors are written for two readers**: a human in a terminal and an agent in a transcript.
  Say what went wrong and what to do about it.
- **CLI exit codes are a contract**: `0` success, `1` understood but could not be done, `2`
  malformed request. Agents branch on these, so do not repurpose them.

## Definition of done

A change is done when all of the following are true. Do not report completion otherwise.

1. `npm run check` passes — format, types, and tests.
2. New behaviour has tests. Core logic in particular: ranks, ids, validation and round-tripping
   are exactly where silent bugs live.
3. No boundary above was crossed.
4. If an architecture or data-model decision changed, AGENTS.md was updated in the same change,
   and a new ADR was added under `docs/adr/` where the decision meets the bar in Decisions.
   Reversing an earlier decision supersedes its ADR rather than editing it away. Likewise if a
   directory was added, removed, or changed purpose. The Repo map is only true because updating
   it is part of done.
5. If a term changed meaning, gained a better name, or was invented, the relevant `CONTEXT.md`
   was updated in the same change. A stale glossary is worse than no glossary.
6. If the CLI's interface changed, `.claude/skills/tasks/SKILL.md` was updated to match, and
   `.claude/skills/plans/SKILL.md` too where the change touches plans. Those files are the
   contract agents rely on; they drift apart from the CLI the moment you forget. Both are
   compiled into the binary, so a stale skill ships to every project the user initialises.

## Deliberately not built

Each of these was considered and pushed out. They are here so they do not creep back in as
unplanned work. Building one is a decision, not a tidy-up.

- **One file per task** — `.tasks/<id>.md` on disk. The editor experience it buys is already
  covered by the virtual `task:` document, and it costs a route around the CLI's validation, N
  reads per list, and a migration. Revisit if tasks need editing outside VSCode, or in git.
- **Subtasks and checklists** — real schema and UI cost. Revisit once the flat model visibly
  fails.
- **A status that means "finished"** — this entry used to advise adding an explicit flag on a
  status rather than blessing a name, since renaming a special column would break things
  quietly ([ADR 0019](docs/adr/0019-statuses-are-per-project.md)). **That advice is void.**
  [ADR 0023](docs/adr/0023-the-four-columns-are-fixed.md) fixed the columns, which removed the
  rename risk rather than working around it: `done` is now built as terminal, and a task reads
  as blocked when a prerequisite's status is not `done`.
  [ADR 0024](docs/adr/0024-in-review-joins-the-fixed-columns.md) later grew the fixed set to
  five without reopening that risk.
- **Conflict resolution** — detecting that a task changed on disk under an open edit.
  Last-write-wins ships; add the banner if text is actually lost.
- **Configurable category colours** — the hash-to-palette assignment is stable and free. A picker
  is a settings surface, a migration on rename, and a decision every time a bucket is added.
  Revisit if two categories you care about keep colliding.
- **Cross-project aggregation** — a registry of project paths and one board across repos. The
  prefixed ids are what make it possible without a rewrite; nothing else is built for it.
- **MCP server** — a typed-tool front door onto the same core. Worth it only if a client you use
  handles MCP better than it handles a shell.
- **SQLite backend** — a contained swap behind `TaskStore`. Genuinely worth doing somewhere north
  of ten thousand tasks ([ADR 0002](docs/adr/0002-core-owns-the-store-behind-an-interface.md)).

## Watch out for

The four failure modes this design is most exposed to:

- **Rank exhaustion** — midpoint insertion runs out of room. Needs a renumbering trigger from day one.
- **Schema drift** — agents adding fields. Reject unknown keys.
- **Interleaved writes** — two agents at once. Atomic write-and-rename, in core.
- **Watcher thrash** — the board's own writes re-triggering its watcher. Debounce and self-ignore.
