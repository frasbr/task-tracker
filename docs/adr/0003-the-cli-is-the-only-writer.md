# The CLI is the only writer of the store

Every mutation runs through the `tasks` binary, whatever surface it started from. The board's
webview asks the extension host, the host spawns the CLI, and an agent editing a task uses the
same verbs a human does.

One writer gives one place where validation happens and one process ordering concurrent writes.
Neither survives a second component deciding it knows enough to edit the file itself. It also
makes the CLI's `--json` output a contract rather than a convenience.
