# Task model

The data at the centre of the project. What a task is, what a project's columns are, and the
store that holds them. Every other context borrows this vocabulary, so a term redefined here is
redefined everywhere.

## Language

### The task

**Task**:
One piece of work, held as eleven fixed fields. The unit everything else moves, renders or
filters.
_Avoid_: item, ticket, issue, story, todo. A **Card** is a task drawn on the board, defined in
the Board context.

**Notes**:
The markdown body of a task. Free-form, may be multi-line, and the only field with no shape
imposed on it.
_Avoid_: description, body, comment, detail

**Category**:
The single bucket a task belongs to. Drives grouping and colour. A task has exactly one, or
none.
_Avoid_: type, kind, area, project

**Tag**:
One of many free-form labels on a task. Drives filtering. A category answers which part of the
system; a tag answers anything else.
_Avoid_: label, keyword, marker

**Ref**:
A pointer into real code, such as `src/auth.ts` or `src/auth.ts:42-58`. What connects a task to
the thing it is about.
_Avoid_: link, reference, location, citation

**Prerequisite**:
A task another task waits on, held in `blockedBy` as a list of ids. The store checks that
each id names a task that exists and that no chain of prerequisites loops back on itself;
beyond that it is display only — nothing refuses to move a task whose prerequisites are
outstanding. Distinct from a **Ref**, which points at code rather than at other work.
_Avoid_: dependency, parent, blocker, upstream

**Blocked**:
Said of a task with at least one outstanding prerequisite. A property read off the board, not a
status — no column means blocked.
_Avoid_: waiting, stuck, held

### Identity

**ID**:
A task's permanent handle, `<prefix>-<n>`, e.g. `task-tracker-7`. The whole qualified string is
the id, not the number alone. Survives editing, reordering and status changes.
_Avoid_: key, uid, slug

**Prefix**:
The project's own leading part of every id, set once at `init`. No hyphen-separated part of it
may be digits only, or an id becomes ambiguous to split.
_Avoid_: namespace, scope, project code

**Legacy ID**:
The random `t` plus 8-character id shape used before prefixes existed. Recognised only so it
can be converted.
_Avoid_: old id, v1 id

**Migration**:
Converting a store's legacy IDs to the current shape, rewriting references to them in task text
at the same time.
_Avoid_: upgrade, conversion

### Columns and ordering

**Status**:
The column a task is in, named by the project rather than fixed by the schema. Both the field
on the task and the entry in the project's ordered list.
_Avoid_: state, stage, phase, bucket

**Column**:
A status together with the tasks carrying it, in rank order. The same concept as a status,
named from the reader's side. Use "status" for the stored value and the CLI argument, "column"
for what it looks like on a board.

**Rank**:
A task's manual position within its column, held as a string that sorts lexicographically.
Inserting between two neighbours never rewrites anyone else's rank.
_Avoid_: order, index, sort key, position

**Position**:
A request to place a task relative to its new neighbours. Before one, after another, or
neither, which means the end of the column. A caller asks for a position; the store allocates a
rank in response.
_Avoid_: placement, target, destination

**Renumbering**:
Rebuilding every rank in one column with fresh spacing, after repeated insertion into the same
gap has grown the keys too long. The answer to rank exhaustion.
_Avoid_: rebalancing, reindexing, compaction

### Storage

**Project**:
A directory tree with a `.tasks/` in it. Tasks belong to a project, never to a user or a team,
and every project's board is independent.
_Avoid_: workspace, repo, folder

**Store**:
Where a project's tasks live, reached only through the `TaskStore` interface. JSONL is the
current implementation and callers are not allowed to know that.
_Avoid_: database, file, backend, storage layer

**Config**:
A project's own settings beside its store. The id prefix, the counter that mints the next
number, and the ordered status list.
_Avoid_: settings, preferences, options

**Draft**:
The fields a caller may supply when creating a task. The store allocates the rest: id, rank,
created, updated.
_Avoid_: new task, input, payload

**Patch**:
The fields a caller may change on an existing task. `id` and `created` are immutable and
`updated` is automatic, so none of them appear in one.
_Avoid_: update, changes, delta, diff

**Task document**:
A task rendered as editable text, with a small `key: value` header and markdown notes below,
and read back again. A projection for editing, never a second place tasks are stored.
_Avoid_: frontmatter, markdown file, task file

**Unknown field**:
A key that is not one of the eleven. Always an error, never something to store or ignore. This is
what keeps the model eleven fields wide when agents write to it.
_Avoid_: extra field, custom field, extension
