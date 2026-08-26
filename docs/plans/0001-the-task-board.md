# 0001. The task board

> **Complete and frozen, 25 August 2026.** Every phase in the build order below shipped. This is
> the original design document, kept as the record of how the system was argued into existence.
>
> **It is not authoritative and it is not maintained.** [AGENTS.md](../../AGENTS.md) is the source
> of truth for architecture and the data model, and the reasoning has graduated to
> [docs/adr/](../adr/). Where this file disagrees with those, they are right. The deferred list
> near the end now lives in AGENTS.md under "Deliberately not built"; the per-project status
> argument is [ADR 0019](../adr/0019-statuses-are-per-project.md).
>
> Rendered version: <https://claude.ai/code/artifact/98580f5e-2336-4de0-9014-cddb13d64f3c>

A per-project task board that a coding agent and a human edit through the same plain-text
store, rendered as a kanban tab inside VSCode.

|               |                      |
| ------------- | -------------------- |
| **Store**     | `.tasks/tasks.jsonl` |
| **Config**    | `.tasks/config.json` |
| **IDs**       | `<prefix>-<n>`       |
| **Surface**   | VSCode webview       |
| **Agent API** | `tasks` CLI + skill  |
| **Scope**     | current workspace    |
| **Git**       | ignored              |

---

## The shape of it

One rule drives the whole architecture: **the CLI owns the store, and nothing else opens it.**
Your coding agent shells out to the CLI. The VSCode extension shells out to the same CLI. That
keeps every write going through one validated path, and it keeps the extension free of any
dependency that has to be compiled against VSCode's runtime.

```
  ┌──────────────────────┐              ┌────────────────────────────┐
  │ Coding agent         │              │ VSCode extension           │
  │ Claude Code, Cursor, │              │ board webview + ext host   │
  │ any shell            │              │                            │
  └──────────┬───────────┘              └─────────────┬──────────────┘
             │ spawn                          spawn   │        ▲
             │                                        │        │
             └────────────────┐      ┌────────────────┘        │
                              ▼      ▼                         │
                   ┌────────────────────────────────┐          │
                   │ tasks CLI  ·  core library     │          │
                   │ schema · validation · ids ·    │          │
                   │ ranks · store adapter          │          │
                   └───────────────┬────────────────┘          │
                                   │ read · write              │
                                   ▼                           │
                   ┌────────────────────────────────┐          │
                   │ .tasks/tasks.jsonl             │          │
                   │ one task per line · gitignored │ ─────────┘
                   └────────────────────────────────┘   fs watch → re-render
```

The watch path is what makes the thing feel collaborative rather than like two apps fighting
over a file. The extension watches the store directly, so when an agent flips a task to `done`
mid-session, the card moves across the board about a fifth of a second later. No refresh button
exists, because there is nothing to refresh — disk is the only truth.

---

## Decisions already locked

These came out of the design conversation and are treated as settled. Everything in the
component breakdown assumes them.

| Question            | Decision                    | Reasoning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Storage**         | JSONL, one task per line    | One file, no native dependency anywhere, line-addressable so a single task can be read or patched in isolation. Kept behind a store interface so SQLite remains a contained swap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Frontend**        | VSCode webview              | No port to manage, no process to remember to start, and code references can open straight into the editor beside the board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Scope**           | Current workspace           | Board reads the open project's store. IDs and the store format are designed so cross-project aggregation bolts on later without a migration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Version control** | Gitignored via `.gitignore` | Private working memory shared with agents, not a team artifact. `.git/info/exclude` was considered and rejected: it is untracked and per-clone, but also invisible, and the team friction it avoids does not exist for a single-user tool on hobby projects. `.gitignore` is where you will actually look.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Task IDs**        | `<prefix>-<n>`, incremental | `task-tracker-7`, not `ty4zm4d4d`. You type IDs constantly, and a number you can say out loud is worth more than an opaque handle. The prefix defaults to the repo name, is set once with `tasks init --prefix`, and makes the ID unique across projects — which is what the deferred cross-project board needs. The counter lives in `.tasks/config.json` so a deleted task never hands its number to a new one. Changing the prefix afterwards is a migration, not a setting.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Statuses**        | Per-project, ordered list   | Columns are the project's own, held in `.tasks/config.json` and defaulting to the four below when the file is absent. A repo that works in reviews wants a `review` column; one that does not should not carry it. The cost is real and accepted: validation stops checking against a compile-time enum and starts checking against the store's config, and agents must ask what the statuses are rather than assuming.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **Task detail**     | A virtual editor document   | Clicking a task opens a `task:` URI, named `<prefix>-<n>-<slug>.md`, that reads and writes through the CLI. Identity is the `<prefix>-<n>` at the front and the slug is cosmetic, so renaming a task never strands the buffer you are typing in. It gives you a real editor tab — markdown, undo, ⌘S — without splitting the store into one file per task, so there is no migration and no second source of truth. The document exposes six of the ten fields; `rank`, `created` and `updated` stay the store's to allocate. The board card opens the same document rather than growing a second editing surface — a form that also edits notes and refs would just be this, worse, and now two things to keep in sync. What a form buys over an editor tab (validation before save, a status dropdown instead of typed text) is cheap enough to keep on the card itself as separate gestures instead: drag to change status or reorder, a delete affordance, nothing more. |
| **Agent interface** | CLI + a skill               | Works with any agent that has a shell, is testable on its own, and the skill file teaches the verbs once instead of every session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **Sync**            | File watcher, auto-update   | External writes re-render the board. Last write wins on the rare simultaneous edit; a conflict banner is explicitly deferred.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Why JSONL and not SQLite

The format barely affects agent token cost — the read interface does. An agent running
`tasks list --status=priority` spends ~200 tokens regardless of the backing store; an
agent that `cat`s the whole store spends thousands regardless too. So the store was picked for
write-safety and dependency cost, not for query power.

SQLite's wins — indexed queries, partial writes, no parse step — start mattering somewhere north
of ten thousand tasks. Its costs apply immediately: an opaque file you cannot hand-repair, and a
compiled addon that must be rebuilt whenever VSCode bumps Electron. The CLI-owns-the-store design
removes the addon problem for either choice, which makes this decision cheap and reversible
rather than load-bearing.

---

## Data model

Ten fields. Everything the board renders and everything an agent needs to reason about a task,
with nothing speculative. Timestamps and rank in particular are cheap to write now and painful
to backfill later.

| Field      | Shape                   | Purpose                                                                                                                                                                 |
| ---------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`       | `<prefix>-<n>`          | Stable handle an agent can quote, e.g. `task-tracker-7`. Survives reordering, editing and deletion — numbers are never reused. The CLI takes the bare `7` as shorthand. |
| `title`    | one-line string         | The headline on the card.                                                                                                                                               |
| `notes`    | markdown string         | Body of the task. Multi-line; the CLI handles escaping so nobody hand-writes it.                                                                                        |
| `category` | single string           | One bucket per task. Drives grouping and colour-coding.                                                                                                                 |
| `tags`     | string array            | Many per task. Drives filtering.                                                                                                                                        |
| `status`   | one of the project's    | Which column the card sits in. Validated against `.tasks/config.json`, not a fixed enum.                                                                                |
| `rank`     | sortable key            | Manual position within a column, so drag-and-drop order persists.                                                                                                       |
| `created`  | ISO timestamp           | Set once. Enables staleness sorting.                                                                                                                                    |
| `updated`  | ISO timestamp           | Touched on every write. Enables "what moved today" and "closed this week".                                                                                              |
| `refs`     | array of `path[:lines]` | Links a task to real code. Click-to-open in the webview — the thing a generic task app cannot do.                                                                       |

**Statuses** are per-project. `.tasks/config.json` holds them as an ordered list, and that order
is the left-to-right order on the board and top-to-bottom in the sidebar. A store with no config
file behaves exactly as it does today, because the default list is:

- `backlog` — captured, not committed
- `priority` — next up
- `in-progress` — being worked now
- `done` — finished

Any of the four can be renamed, reordered or removed, and new ones added, through
`tasks status`. Nothing in the system treats a particular name as special: there is no built-in
notion of "the done column", and features that need one — closed-this-week, say — take it as a
question to answer later rather than a name to hardcode.

The canonical TypeScript definition of a task lives in `packages/core/src/task.ts`, and the
config's shape beside it. Adding a field is a plan-level decision: change this table first.

---

## Components

Seven parts, each with a clean boundary. Discrete tasks get derived _inside_ these, not across
them — the seams here are where the work should split.

### Core library

_shared module · no I/O opinions · `packages/core`_

The single definition of what a task is and the only code that touches the store. Everything
else is a caller.

- Task schema, the project's status list, and validation with useful errors on bad input
- Reading and writing `.tasks/config.json`, including the default list when it does not exist
- A store interface plus its JSONL implementation, so the backing format stays swappable
- ID allocation from a counter in the config, so a retired number is never handed out again.
  The counter is written before the task it names: a gap in the numbering is harmless, a
  collision is not
- Rank allocation for reordering — insert between two neighbours without renumbering the column
- Query and filter primitives: by status, category, tag, recency
- Atomic writes, so a crash mid-save cannot leave a half-written store

**Done when** round-trip tests pass for every field including multi-line notes, and reordering a
column a hundred times produces no rank collisions.

### tasks CLI

_the only writer · agent + extension entry point · `packages/cli`_

The public surface of the system. Both humans and agents drive it; the extension shells out to
it rather than reimplementing anything.

- Verbs covering the full lifecycle: `init`, `add`, `list`, `show`, `update`, `move`, `note`, `remove`
- `status list | add | rename | reorder | remove`, the only way the project's columns change.
  Removing a status that still holds tasks requires saying where they go
- Two output modes — compact human/agent lines by default, structured JSON for the extension
- Filter flags on `list`, so an agent can ask for exactly the slice it needs and nothing more
- Locating the project store by walking up from the working directory
- `init` that creates the store, its config and the gitignore entry in one step, taking
  `--prefix` for the ID prefix and defaulting it to the repository's own name
- Accepting a bare number wherever an ID is taken, so `tasks show 7` works
- Exit codes and errors that read well both in a terminal and in an agent transcript

**Done when** you can run a full week of your own task management through the CLI alone, with no
UI in existence.

### Agent skill

_documentation as interface · `.claude/skills/tasks/`_

Teaches an agent the verbs and, more importantly, the etiquette — when to create a task, when to
move one, and how to read without burning context.

- The verb reference, written for an agent rather than for a human reading `--help`
- Statuses as something to look up, never to assume — the four defaults are this project's
  starting point, not the schema
- Explicit guidance to query narrowly instead of dumping the whole store
- Conventions for what belongs in notes versus refs versus a new task
- Worked examples covering the common moves an agent makes mid-session

**Done when** a fresh agent session manages tasks correctly with no instruction from you beyond
the skill being present.

### Extension host

_the bridge layer · `packages/extension/src/extension.ts`_

Connects VSCode to the CLI and to the filesystem. Holds no task logic of its own — if it starts
parsing the store, something has gone wrong.

- Activation, the command to open the board, and webview lifecycle including restore after reload
- Spawning the CLI and marshalling structured results to and from the webview
- Watching the store and pushing updates to the board, debounced so a burst of agent writes
  causes one re-render
- Opening a code reference in an editor at the right line when a card is clicked
- Graceful states for the two cases that will happen: no store in this workspace, and CLI not found

**Done when** an external CLI write updates the open board without any user action, and closing
and reopening VSCode restores the board intact.

### Task documents

_the editor surface · `packages/core/src/document.ts` + `packages/extension/src/task-document.ts`_

A task opened as an ordinary editor tab. Core renders and parses the document format; the
extension registers it as a filesystem provider so VSCode treats a `task:` URI like a file.

- A header of scalar fields and lists, then the notes as markdown below the fence
- Parsed back through the same validation as any other write, so a bad status fails on save
  with the buffer intact rather than reaching the store
- The `id` travels in the header and is checked on save — a document pasted between tasks is
  refused rather than overwriting the wrong one
- The document is named for the task it holds, `tt-7-watch-the-store.md`, with the identity at
  the front and a slug of the title behind it. A stale slug is harmless; a stale identity would
  not be, which is why only one of them is in the URI's contract
- Reads and writes go through `tasks show --markdown` and `tasks update --markdown`, which
  means the same round trip works from a terminal with a pipe

**Done when** you can open a task from the sidebar, edit any field it exposes, save, and see the
store's normalised version come straight back into the buffer.

### Board UI

_webview · the part you look at · `packages/extension/src/webview/`_

Columns, cards, and the editing surface. Should feel native to the editor rather than like a
website embedded in a tab.

- One column per configured status, in the configured order, with cards showing title,
  category, tags, and ref count
- Drag to move between columns and to reorder within one, persisted through `rank`
- Click a card to open its document — the same `task:` editor tab the sidebar opens, not a
  second editing surface. The card itself keeps only the gestures cheap enough not to compete
  with it: drag to change status or position, and delete
- Create a task without leaving the board
- Filter by category and tag; sort a column by rank, recency, or age
- Theme inheritance so the board tracks the user's VSCode colour theme

**Done when** you reach for the board instead of the CLI for your own edits, and an agent's
changes appear under your cursor while you work.

### Sidebar list

_activity bar · the always-there view · `packages/extension/src/tasks-tree.ts`_

The board without the board: the same CLI output, grouped into collapsible status groups narrow
enough for a sidebar. It is where most glances happen, so it earns the cheap gestures.

- One collapsible group per configured status, with a count, in the configured order
- Click a task to open its document; its refs are one context-menu entry away
- A `+` in the view title that creates a task, and can create a status — the two things you
  reach for that no other surface offers without a terminal
- Category shown as colour: the label tinted and badged from a palette hashed off the category
  name, so the same bucket looks the same everywhere without anyone configuring anything

**Done when** you can run a day from the sidebar alone — see what is in flight, open it, edit
it, and file something new — without opening the board or a terminal.

---

## Build order

Sequenced so the system is genuinely usable after phase two — before a single pixel of UI
exists. That ordering is deliberate: it tests the data model against real use while changing it
is still cheap. Estimates assume you are building with agent assistance.

| #   | Phase                                | What lands                                                                                                                                                                                                                   | Estimate |
| --- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 0   | **Scaffolding**                      | Workspace, tooling, skeleton packages, this plan, AGENTS.md, the skill.                                                                                                                                                      | ✅ done  |
| 1   | **Core library and store**           | Schema, validation, the JSONL adapter, IDs, ranks, atomic writes. No CLI, no UI — just a well-tested module that can hold tasks.                                                                                             | ✅ done  |
| 2   | **CLI and agent skill**              | All verbs, both output modes, `init`. Point an agent at the skill and start using the system for real work immediately.                                                                                                      | ✅ done  |
| 3   | **Extension shell, read-only board** | Scaffold the extension, open a webview, render four columns from CLI output. No editing yet. Proves the bridge and the layout.                                                                                               | ✅ done  |
| 4   | **Editing, drag, and the watcher**   | Two-way flow: the task document, create and delete from both surfaces, drag between and within columns, and the file watcher that makes agent writes appear live. The biggest phase and the one that makes it feel finished. | ✅ done  |
| 6   | **Project identity**                 | `.tasks/config.json`, the ID prefix, incremental IDs and the one-shot migration off the opaque ones. Small, and it has to precede statuses because both push validation off compile-time constants and onto the config.      | ✅ done  |
| 5   | **Code refs and filters**            | Click a ref to open the file at its line, filter by category and tag, sort columns, and colour the sidebar by category. The payoff for living inside the editor.                                                             | ✅ done  |
| 7   | **Project statuses**                 | `.tasks/config.json`, the `tasks status` verbs, validation against the configured list rather than an enum, dynamic columns on both surfaces, and creating a status from the sidebar `+`.                                    | ✅ done  |

Phase 6 shipped before phase 5 — it lands `.tasks/config.json`, which phase 7 builds on, so it
was pulled forward. Every phase is now done.

---

## Deliberately deferred

Each of these was considered and pushed out. They are listed so they do not creep back in as
unplanned work — and so the phase-one design leaves room for them.

- **One file per task** _(storage)_ — `.tasks/<id>.md` on disk, editable by any tool. Considered
  once the sidebar made tasks clickable, and rejected: the editor experience it buys is already
  covered by the virtual `task:` document, while the costs are real — a route around the CLI's
  validation, N reads for every list, and a migration. Revisit only if tasks need to be editable
  outside VSCode or visible in git.
- **Configurable category colours** _(sidebar)_ — picking the colour for a category by hand. The
  hash-to-palette assignment is stable and free; a colour picker is a settings surface, a
  migration when a category is renamed, and a decision to make every time you add a bucket.
  Revisit only if two categories you care about keep colliding.
- **A status that means "finished"** _(schema)_ — marking one column terminal, so reports can say
  what closed this week. Deliberately not built with custom statuses: the moment one name is
  special, renaming it breaks things quietly. Add it as an explicit flag on a status if a
  feature actually needs it.
- **Cross-project aggregation** _(scope)_ — a registry of project paths and a unified board
  across repos. The prefixed IDs are what makes this possible without a rewrite: `task-tracker-7`
  and `dotfiles-7` already coexist. Nothing is built for it yet.
- **MCP server** _(agent API)_ — a typed-tool front door wrapping the same core. Worth it only
  if a client you use handles MCP better than a shell.
- **Subtasks and checklists** _(schema)_ — turning a card into a live progress bar an agent ticks
  off. Real schema and UI cost; revisit once the flat model shows its limits.
- **Conflict resolution** _(sync)_ — detecting that a task changed on disk under an open edit.
  Last-write-wins ships first; add the banner if you actually lose text.
- **SQLite backend** _(storage)_ — sits behind the store interface as a contained swap. Genuinely
  worth doing somewhere north of ten thousand tasks, which is not soon.

---

## What will bite

The four failure modes worth designing against up front, because each is much cheaper to prevent
than to retrofit.

- **Rank exhaustion** _(data integrity)_ — repeated midpoint insertions eventually run out of room
  between two neighbours. Needs a defined renumbering trigger from day one, not after it breaks.
- **Agents inventing fields** _(schema drift)_ — given any latitude an agent will add a
  plausible-looking key. Validation must reject unknown fields loudly rather than silently
  storing them.
- **Interleaved writes** _(concurrency)_ — two agents writing the same store at once can corrupt a
  whole-file rewrite. Atomic write-and-rename is the mitigation, and it belongs in the core.
- **Mistyped IDs that hit a real task** _(safety)_ — the opaque IDs were built from an alphabet
  without `i`, `l`, `o` or `u` so a typo failed loudly. `7` and `17` are both valid, so a slip
  on a destructive verb now lands somewhere real. `remove` has to confirm what it is about to
  delete; that guard is part of the ID change, not a follow-up.
- **Orphaned statuses** _(data integrity)_ — a status renamed or removed while tasks still carry
  it leaves cards in a column that no longer exists. Every status write has to account for the
  tasks pointing at it, in the same atomic write, or the board silently loses them.
- **Agents assuming the four names** _(schema drift)_ — every agent transcript in existence says
  `backlog`, `priority`, `in-progress`, `done`. Once statuses are per-project the skill has to
  teach discovery, and the CLI's error on an unknown status has to list the ones that exist.
- **Watcher thrash** _(feedback loop)_ — a board edit writes the file, the watcher fires, the board
  re-renders mid-drag. Needs debouncing plus ignoring writes the extension itself caused.
