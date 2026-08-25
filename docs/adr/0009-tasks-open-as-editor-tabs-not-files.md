# Tasks open as editor tabs, not files on disk

A task opens under a `task:` URI. VSCode treats it like a file, with a normal editor, markdown
highlighting from the `.md` name and the usual save keystroke, while nothing is written to
disk. Reads run `tasks show --markdown` and saves run `tasks update --markdown`.

The result behaves like one file per task without being one. Real files would have meant a
migration, a second source of truth and a route around the CLI's validation.

## Consequences

The URI is `task:/<prefix>-<n>-<slug>.md`. The id is the identity and the slug is cosmetic, so
it can go stale the moment the title changes. Only the id half is ever compared, which is what
stops a rename from stranding the tab someone is typing in.
