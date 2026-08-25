# The extension shells out to the CLI rather than importing core

The VSCode extension never imports `@task-tracker/core`. It reaches task data by spawning
`tasks` and parsing `--json`, and it holds no task logic of its own. No parsing, no validation,
no rank arithmetic.

Linking core into the extension host would put a second writer inside the editor process, drag
core's ESM and any compiled dependency into a bundle that has to stay CommonJS, and make the
CLI optional in a design where it is the contract. Spawning a subprocess on every read is
slower. Worth it.

## Consequences

- `BoardTask` in `protocol.ts` restates the ten task fields by hand. The duplication is the
  price of this decision, not an oversight. When the CLI's JSON changes, that type changes with
  it.
- The extension locates `.tasks/` with its own upward walk, duplicating core's. A path
  convention is not task data, so it does not breach the rule.
- The webview goes further still, with no filesystem or Node access at all. It talks to the
  host over `postMessage`, and every mutation is a request the host turns into a spawn.
