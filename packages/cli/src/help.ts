/**
 * Usage text.
 *
 * Kept in step with `.claude/skills/tasks/SKILL.md` by hand. That file is the contract
 * agents are told to rely on; if a verb changes here and not there, agents will call
 * something that no longer exists.
 */

export const USAGE = `tasks — the project's task board

usage
  tasks <command> [arguments] [flags]

commands
  init                       create .tasks/ in this project
  add <title>                create a task
  list                       list tasks, one compact line each
  show <id>                  print one task in full
  update <id>                change fields on a task
  move <id> <status>         change column, optionally repositioning
  note <id> <text>           append to a task's notes
  remove <id>                delete a task

statuses
  backlog · priority · in-progress · done

global flags
  --json                     machine-readable output
  -C <dir>                   run as if started in <dir>
  --help, -h                 this text, or a command's own help
  --version

Run \`tasks <command> --help\` for a command's flags.`;

export const COMMAND_HELP: Readonly<Record<string, string>> = {
  init: `tasks init — set this project up for task tracking

  Creates .tasks/ and, where there is a git repo, adds it to .gitignore. Tasks are
  local working memory, not a team artifact.

  Also installs the agent skill to ~/.claude/skills/tasks/ the first time it runs, so
  agents in every project know these commands exist. That is the one thing this
  command writes outside the project, and it says so when it does.

  --skip-skill               only create the store

  tasks init`,

  add: `tasks add <title> — create a task

  --category=<name>          one bucket; reuse an existing one where you can
  --tags=<a,b,c>             comma separated, no spaces inside a tag
  --status=<status>          defaults to backlog
  --notes=<text>             the body; multi-line is fine
  --refs=<path[:lines],...>  e.g. src/auth.ts:42-58

  tasks add "Fix auth redirect loop" --category=auth --tags=bug,frontend`,

  list: `tasks list — list tasks, one compact line each

  --status=<status[,...]>    filter by column
  --category=<name>
  --tag=<name>               repeatable via --tag=a,b; a task must carry every tag
  --query=<text>             substring match across title and notes
  --json

  Filter your reads. An unfiltered list is rarely what you want.

  tasks list --status=priority
  tasks list --tag=bug --status=backlog`,

  show: `tasks show <id> — print one task in full, including notes and refs

  --json

  tasks show t1ep9qf7v`,

  update: `tasks update <id> — change fields on a task

  --title=<text>
  --category=<name>
  --tags=<a,b,c>             replaces the existing tags; --tags= clears them
  --status=<status>          appends to the end of the new column
  --notes=<text>             replaces the notes; use \`tasks note\` to append
  --refs=<path[:lines],...>  replaces the existing refs

  tasks update t1ep9qf7v --tags=bug,urgent`,

  move: `tasks move <id> <status> — change column, optionally repositioning

  --after=<id>               place directly after that task
  --before=<id>              place directly before that task

  With neither, the task lands at the end of the column.

  tasks move t1ep9qf7v in-progress
  tasks move t1ep9qf7v priority --before=tgyft9rev`,

  note: `tasks note <id> <text> — append to a task's notes

  Appends rather than replaces, so a task accumulates its own history. Use
  \`tasks update --notes=\` to overwrite instead.

  tasks note t1ep9qf7v "Root cause: redirectTo is double-encoded."`,

  remove: `tasks remove <id> — delete a task

  tasks remove t1ep9qf7v`,
};
