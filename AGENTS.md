# AGENTS.md

Guidance for coding agents working in this repo. Read this before writing code, and read
[PLAN.md](PLAN.md) before making any decision that touches architecture or the data model.

---

## What this is

A per-project kanban board that coding agents and humans edit through one plain-text task store.
Three parts: a **core library** that owns the data, a **CLI** that is the only thing allowed to
touch the store, and a **VSCode extension** that renders a board by shelling out to that CLI.

Full design, rationale, component breakdown and phasing: **[PLAN.md](PLAN.md)**.

## Where the work is

Phases 0-4 are done. **Phase 5 is next: code refs and filters.**

The board is two-way: cards open their document, drag persists through `rank`, tasks are created
and deleted from both surfaces, and the `.tasks/` watcher makes an agent's writes appear without
a refresh. Phase 5 is the payoff for living inside the editor — filtering a column by category and
tag, sorting it by rank, recency or age, and colouring the sidebar by category.

Two rules phase 4 established that phase 5 must not undo:

- **Every mutation goes through the CLI.** The webview asks the host, the host spawns `tasks`.
  Do not let the webview hold authoritative state — it renders what the store says. Filtering and
  sorting are the exception that proves it: they are view state, they belong in the webview, and
  they must survive a re-render rather than being written anywhere.
- **Watcher thrash.** The board's own writes retrigger its watcher. A render arriving mid-drag is
  deferred until the drag ends; keep that guard when you touch the render path.

To try it: press F5, or run the "Run the Task Tracker extension" launch configuration. That opens
a development host; run `Task Tracker: Open Board` in it with a project folder open.

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

```
PLAN.md                       the design. The source of truth for decisions.
AGENTS.md                     this file. How to work here.
.claude/skills/tasks/         the skill that teaches agents to USE the tool (not build it).
                              Compiled into the tasks binary and installed by `tasks init`.
                              This is the master copy — edit it here, never in ~/.claude.
bin/install-cli               installs `tasks` to ~/.local/bin as a standalone copy
bin/install-extension         builds, packages and installs the board into VSCode
                              (--status / --uninstall / --dev; VSCODE_EXTENSIONS_DIR
                              redirects it, which is how it is tested safely)
bin/tasks-init                one-command setup for a new repo: skill + store

packages/core/                schema, validation, store. No I/O opinions, no CLI concerns.
  src/task.ts                 the ten-field Task model + status enum
  src/store.ts                the TaskStore interface every caller depends on
  src/validate.ts             parsing + the unknown-field rejection that stops schema drift
  src/rank.ts                 fractional ordering keys + the renumbering trigger
  src/ids.ts                  short, non-reusable, mistype-resistant task IDs
  src/jsonl.ts                the TaskStore implementation. Atomic write-and-rename.
  src/document.ts             a task as an editable text document, and back again
  src/locate.ts               walking up from cwd to find the project's .tasks/
  src/index.ts                public surface — the only thing other packages import

packages/cli/                 the `tasks` binary. The only writer of the store.
  src/index.ts                entry point: wires run() to the real terminal
  src/run.ts                  dispatch + every verb. Takes its IO as arguments.
  src/args.ts                 the small hand-rolled flag parser
  src/format.ts               compact lines vs --json. Two modes, not one prettied.
  src/help.ts                 usage text — keep in step with SKILL.md
  src/skill.ts                installs the skill, which is bundled into the binary
  md-loader.mjs               lets `node --test` load the .md import esbuild inlines
  esbuild.mjs                 bundles to dist/tasks.js (ESM, shebang)

packages/extension/           the VSCode extension
  src/extension.ts            activation + command registration. Nothing else.
  src/tasks-tree.ts           the activity-bar list. Same CLI data as the board, grouped.
  src/task-document.ts        the `task:` filesystem provider — tasks as editor tabs
  src/board-panel.ts          webview lifecycle, message marshalling, opening refs
  src/cli.ts                  spawns `tasks --json`. The only route to task data.
  src/interpret.ts            the pure bits worth testing: ref parsing, error mapping, wording
  src/protocol.ts             host ↔ webview message types (and BoardTask — see below)
  src/webview/main.ts         board UI — browser context, no Node APIs
  media/board.css             styling, entirely in --vscode-* theme variables
  media/icon-board-*.svg      the editor title-bar button icon (light/dark pair)
  media/icon-activitybar.svg  the activity-bar icon (24x24, masked and tinted by VSCode)
  esbuild.mjs                 two bundles: extension (CJS) + webview (ESM)
```

---

## Stack decisions

Made deliberately. Change them only with a stated reason, and update this table when you do.

| Choice     | What                                                                                  | Why                                                                                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language   | TypeScript, `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` | The VSCode extension host runs JS, so this was effectively forced. The extra strictness is cheap insurance in a repo where agents write most of the code.                                                                    |
| Runtime    | Node ≥ 22.18                                                                          | Native TS type-stripping means tests run straight from `.ts` with no transform step.                                                                                                                                         |
| Packages   | npm workspaces                                                                        | Ships with Node, no extra install, and no symlink layouts that trip up `vsce package`. pnpm would be marginally better and is not worth the friction.                                                                        |
| Build      | esbuild                                                                               | Bundling is required for the extension anyway; using it for the CLI too keeps one tool and makes `tasks` start fast.                                                                                                         |
| Tests      | `node --test`                                                                         | Built in. Zero dependencies for the thing that must never rot.                                                                                                                                                               |
| Lint       | none — Prettier only                                                                  | `strict` TS catches most of what ESLint would, and ESLint config is ongoing maintenance nobody here will do. Reconsider if real bugs slip through.                                                                           |
| Webview UI | vanilla TS                                                                            | Four columns and a detail panel. A framework's styling layer fights VSCode theme inheritance more than it helps. If phase 4 state handling gets genuinely hairy, Preact is the escape hatch — say so before reaching for it. |

**Dependencies:** the runtime dependency count is currently zero and that is a feature. Before
adding one, check whether Node's standard library covers it. If you add a dependency, say why in
the commit.

---

## Boundaries that must not be crossed

These are the architecture. Violating one silently is worse than not doing the task.

1. **Only `@task-tracker/core` touches the store.** No other package reads or writes
   `.tasks/tasks.jsonl`. Not the CLI directly, not the extension, not a test helper.

2. **The extension never imports `@task-tracker/core`.** It reaches task data only by spawning the
   CLI and parsing `--json` output. This is why the extension can stay CommonJS while core and
   CLI are ESM, and it is what keeps compiled dependencies out of the extension host. If you find
   yourself adding core to the extension's dependencies, stop.

3. **The extension host holds no task logic.** No parsing, no validation, no rank arithmetic. It
   spawns, marshals, watches, and renders. Logic belongs in core.

4. **The webview has no filesystem or Node access.** It talks to the host over `postMessage` and
   nothing else. Every mutation is a request to the host, which spawns the CLI.

5. **Callers depend on the `TaskStore` interface, never a concrete store.** The JSONL
   implementation is an implementation detail. This is what keeps the SQLite swap contained.

6. **Unknown fields are rejected, loudly.** Validation must fail on keys it does not recognise
   rather than storing them. Agents will invent plausible-looking fields; the schema is the
   defence.

7. **`BoardTask` in `protocol.ts` is a deliberate duplicate of the core `Task` type.** It
   describes the CLI's JSON output, which is all the extension is allowed to know. Do not
   "fix" the duplication by importing core — that is boundary 2, and the duplication is its
   visible price. When the CLI's JSON changes, change this by hand.

8. **Anything writing outside the project must say so.** `tasks init` installs a skill into
   `~/.claude/skills`. Tests must redirect that with `CLAUDE_SKILLS_DIR` — a test run wrote
   into a real home directory once, before `run.test.ts` isolated it.

9. **The extension package must not declare `"type": "module"`.** Its bundle is CommonJS
   because the VSCode extension host expects it, and a `.js` file in a `"type": "module"`
   package is loaded as ESM. Running `node --test` over the extension's `.ts` sources prints a
   MODULE_TYPELESS_PACKAGE_JSON warning because of this; the warning is the correct trade and
   must not be silenced that way.

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
4. If a decision in PLAN.md changed, PLAN.md was updated in the same change.
5. If the CLI's interface changed, `.claude/skills/tasks/SKILL.md` was updated to match. That file
   is the contract agents rely on; the two drift apart the moment you forget. It is compiled
   into the binary, so a stale skill ships to every project the user initialises.

## Watch out for

The four failure modes this design is most exposed to, expanded in
[PLAN.md § What will bite](PLAN.md#what-will-bite):

- **Rank exhaustion** — midpoint insertion runs out of room. Needs a renumbering trigger from day one.
- **Schema drift** — agents adding fields. Reject unknown keys.
- **Interleaved writes** — two agents at once. Atomic write-and-rename, in core.
- **Watcher thrash** — the board's own writes re-triggering its watcher. Debounce and self-ignore.
