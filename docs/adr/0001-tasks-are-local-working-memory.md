# Tasks are local working memory, not a team artifact

A project's board lives in `.tasks/`, and `tasks init` adds that directory to `.gitignore`.
Tasks here are scratch state shared between one person and the agents working alongside them.
Nobody else reads them, so nothing in the design pays for multi-user concurrency, permissions
or sync.

Every other decision rests on this. If tasks ever do need sharing, a single JSONL file, a CLI
with no server and ids minted from a local counter all have to be reconsidered rather than
extended.
