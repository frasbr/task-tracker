# The board

How tasks are presented in VSCode. The board, the sidebar list, and tasks opened as editor
tabs. Renders what the CLI reports and holds no task logic of its own.

Task, status, rank, category, tag and ref are defined in the
[Task Model](../core/CONTEXT.md). This context never imports that code, so the entries below
say how those concepts are presented, and name the things that exist only here.

## Language

### The two halves

**Host**:
The half running in the VSCode extension host, with Node available. Spawns the CLI, watches the
store, and owns every editor surface.
_Avoid_: backend, server, main process

**Webview**:
The half running in a browser context, with no filesystem and no Node. Draws the board and asks
the host for everything else.
_Avoid_: frontend, client, UI layer

**BoardTask**:
A task as the extension knows it. A description of the CLI's JSON output, restated here rather
than imported, and kept in step with core's `Task` by hand.
_Avoid_: Task on its own, which is core's type and invisible from here

### Surfaces

**Board**:
The kanban view in an editor tab. One column per status, cards ranked within each.
_Avoid_: kanban, view, panel, which is its container

**Panel**:
The webview container the board lives in. One at a time, revealed rather than duplicated.
_Avoid_: window, tab, editor

**Card**:
One task drawn on the board. Clicking one opens its task tab. Dragging one changes status and
rank.
_Avoid_: tile, item, node

**Tasks view**:
The activity-bar sidebar. The same CLI output as the board, grouped into collapsible columns
because a sidebar is too narrow to show them side by side.
_Avoid_: tree, explorer, panel, list

**Task tab**:
A task opened as an ordinary editor tab under a `task:` URI. Looks and saves like a file, but
nothing is on disk. Reads and writes both run through the CLI.
_Avoid_: task file, virtual file, document editor

**Document name**:
The `<prefix>-<n>-<slug>.md` a task tab is titled with. The id half is the identity. The slug is
cosmetic and can go stale the moment the title changes.
_Avoid_: filename, path, title

### Behaviour

**Problem**:
Why the board has nothing to show. No workspace, no store, or a CLI that is missing, outdated
or failing. A named state with its own message, not an error to log.
_Avoid_: error, empty state, failure

**View state**:
The filter and sort the webview holds. A presentation choice with no field in the schema, so it
lives only here and must survive a re-render rather than being written anywhere.
_Avoid_: settings, preferences, filters, which names one part of it

**Drop position**:
What a drag reports when it lands. The target column, and the ids either side of the gap. The
webview never computes a rank. It says where the card was dropped and waits to be told what
happened.
_Avoid_: drop target, insertion point, new rank

**Refresh**:
Re-running `tasks list --json` and re-rendering every surface from the result. The only way
anything on screen changes.
_Avoid_: reload, update, sync

**Own write**:
A store change this extension caused, ignored briefly by the watcher so a save does not
re-render everything out from under the person who made it.
_Avoid_: self-change, local write, echo

**Category style**:
The colour and two-character badge a category is drawn with, derived by hashing its name into a
fixed palette of theme colours. Stable across projects and sessions, with nothing to configure.
_Avoid_: theme, decoration, colour scheme
