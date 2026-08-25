# The agent skill ships inside the binary, installed once globally

`.claude/skills/tasks/SKILL.md` is the master copy of the instructions that teach an agent to
use this CLI. It is compiled into the `tasks` binary at build time, and `tasks init` writes it
out to the user's home directory.

Bundling lets `tasks init` install the skill with no reference to the repository the binary was
built from. Installing globally rather than per-project means one copy documents the one
globally installed CLI, instead of a copy in every project going stale as soon as the CLI
changes.

## Consequences

- The next `tasks init` silently overwrites any edit made in the installed location. Edit the
  master copy.
- `tasks init` writes outside the project it was run in, and says so when it does. Any command
  doing that must announce it, and tests must redirect the destination with
  `CLAUDE_SKILLS_DIR`. A test run wrote into a real home directory once.
