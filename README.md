# Task Tracker

A per-project kanban board that coding agents and humans edit through one plain-text store.

Tasks live in `.tasks/tasks.jsonl` inside the project they belong to. Agents read and write them
through a `tasks` CLI; you read and write them on a kanban board that opens as a tab in VSCode.
Both sides watch the same file, so a change from either shows up on the other within about a
fifth of a second.

**Status: phase 3.** The core library, the `tasks` CLI, and a read-only board are done. Editing,
drag, and the live file watcher are next. See [PLAN.md](PLAN.md) for the design and phasing, and
[AGENTS.md](AGENTS.md) for how to work in this repo.

## Layout

| Package              | Role                                                               |
| -------------------- | ------------------------------------------------------------------ |
| `packages/core`      | Task schema, validation, and the only code that touches the store. |
| `packages/cli`       | The `tasks` binary — the only writer of the store.                 |
| `packages/extension` | The VSCode extension: extension host plus the board webview.       |

## Getting started

```bash
npm install
npm run check     # format check + typecheck + tests
npm run build     # bundle the CLI and the extension
```

Requires Node ≥ 22.18.

## Setting up a project

```bash
npm install
npm run install-cli     # installs `tasks` to ~/.local/bin
```

`install-cli` copies one self-contained file. `tasks` is then a normal program on your PATH with
no connection to this checkout — move it, rename it, delete it, and `tasks` keeps working. Re-run
`npm run install-cli` after changing the CLI to update the installed copy. `--to <dir>` or
`TASKS_BIN_DIR` installs somewhere other than `~/.local/bin`.

If you are actively changing the CLI, symlink it instead so every build is live without
reinstalling:

```bash
ln -s "$PWD/packages/cli/dist/tasks.js" ~/.local/bin/tasks
```

Then in any repo you want to track work in:

```bash
cd ~/work/some-project
tasks init
```

That creates `.tasks/` and gitignores it. The first time it runs it also installs the agent skill
to `~/.claude/skills/tasks/`, so agents in every project know these commands exist — it tells you
when it writes outside the project, and keeps a `.bak` if you had edited that copy by hand. Pass
`--skip-skill` to only create the store.

## Using the CLI

In any project that has been through `tasks-init`:

```bash
tasks init                                    # creates .tasks/ and gitignores it
tasks add "Fix auth redirect loop" \
  --category=auth --tags=bug,frontend
tasks list
tasks move <id> in-progress
tasks note <id> "Root cause: redirectTo is double-encoded."
tasks move <id> done
```

`tasks --help` lists the commands; `tasks <command> --help` covers a command's flags. It finds
the store by walking up from wherever you are, so it works from any subdirectory.

Agents get the same interface, plus the etiquette around it, from
[.claude/skills/tasks/SKILL.md](.claude/skills/tasks/SKILL.md).

## The VSCode board

```bash
npm run install-extension
```

Builds, packages, installs into VSCode, and deletes the `.vsix` afterwards. Reload your windows
and **Task Tracker: Open Board** is in the command palette everywhere.

| Command                             | What it does                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run install-extension`         | Install, or update an existing install. No version bump needed.                                                 |
| `bin/install-extension --status`    | What is installed, and whether it matches this checkout.                                                        |
| `bin/install-extension --uninstall` | Remove it.                                                                                                      |
| `bin/install-extension --dev`       | Symlink this checkout instead — rebuilds go live on window reload. A broken build then breaks your real editor. |

VSCode unpacks the extension into its own directory, so like the installed CLI it does not depend
on this checkout. It does not auto-update either: after changing extension code, run
`install-extension` again. `--status` tells you when the two have drifted.

To try a change without installing anything, press <kbd>F5</kbd> instead. That opens a second
VSCode window with the extension loaded, and it disappears when you close it.

### If the board says it cannot find the CLI

The board reads the store by running `tasks`, so VSCode has to be able to find it. VSCode
inherits your shell PATH only when it is launched from a terminal — start it from the Dock or
Finder and `~/.local/bin` will not be there.

The durable fix is to skip PATH entirely:

```jsonc
// settings.json
"taskTracker.cliPath": "/Users/you/.local/bin/tasks"
```
