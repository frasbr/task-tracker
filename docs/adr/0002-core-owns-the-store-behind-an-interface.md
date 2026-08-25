# Core owns the store, behind the TaskStore interface

Only `@task-tracker/core` reads or writes `.tasks/tasks.jsonl`, and callers depend on the
`TaskStore` interface rather than the JSONL implementation behind it.

Hiding the file format keeps a SQLite backend a contained swap instead of a rewrite. Putting
every write in one place makes atomic write-and-rename an invariant, not something each caller
has to remember.

## Consequences

Anything needing task data goes through core, or through the CLI that wraps it. Test helpers
included. That is where the temptation to open the file directly is strongest.
