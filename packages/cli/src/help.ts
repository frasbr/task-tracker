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
  status <sub>               list or change the project's columns
  migrate-ids                convert a pre-prefix store's task IDs

statuses
  Per-project, held in .tasks/config.json. Run \`tasks status list\` to see them;
  a fresh project starts with backlog · priority · in-progress · done. Change them
  with \`tasks status add|rename|reorder|remove\`.

task IDs
  <prefix>-<n>, e.g. task-tracker-7. The bare number is shorthand: \`tasks show 7\`
  works from inside the project the id belongs to.

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

  Creates docs/plans/ too, with a template in it. A plan holds the reasoning behind a
  piece of work; the board holds its state. A task points back at its plan through refs.

  Also installs two agent skills to ~/.claude/skills/ the first time it runs: 'tasks',
  so agents in every project know these commands exist, and 'plans', which teaches
  them to write the documents the work is cut from. That is the one thing this
  command writes outside the project, and it says so when it does.

  --prefix=<name>, -p <name>  the task ID prefix, e.g. \`tt\` for ids like tt-7.
                             Defaults to the repository's own name. Set once, here —
                             changing it afterwards needs \`tasks migrate-ids\`.
  --skip-skill               leave ~/.claude/skills alone (both skills)
  --skip-plans               leave docs/plans/ alone

  tasks init
  tasks init --prefix=tt`,

  add: `tasks add <title> — create a task

  --category=<name>          one bucket; reuse an existing one where you can
  --tags=<a,b,c>             comma separated, no spaces inside a tag
  --status=<status>          defaults to backlog
  --notes=<text>             the body; multi-line is fine
  --refs=<path[:lines],...>  e.g. src/auth.ts:42-58
  --blocked-by=<id,...>      task ids this one waits on; each must already exist

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
  --markdown                 the task as an editable document: header fields, then
                             the notes as markdown. Round-trips through
                             \`tasks update --markdown\`.

  A bare number is shorthand for this project's own prefix.

  tasks show task-tracker-7
  tasks show 7
  tasks show 7 --markdown > task.md`,

  update: `tasks update <id> — change fields on a task

  --title=<text>
  --category=<name>
  --tags=<a,b,c>             replaces the existing tags; --tags= clears them
  --status=<status>          appends to the end of the new column
  --notes=<text>             replaces the notes; use \`tasks note\` to append
  --refs=<path[:lines],...>  replaces the existing refs
  --blocked-by=<id,...>      replaces the existing prerequisites; must exist, no cycles
  --markdown                 read the whole task from stdin as the document
                             \`tasks show --markdown\` writes. Not combinable with
                             the field flags — the document already carries them.

  tasks update 7 --tags=bug,urgent
  tasks update 7 --markdown < task.md`,

  move: `tasks move <id> <status> — change column, optionally repositioning

  --after=<id>               place directly after that task
  --before=<id>              place directly before that task

  With neither, the task lands at the end of the column.

  tasks move 7 in-progress
  tasks move 7 priority --before=12`,

  note: `tasks note <id> <text> — append to a task's notes

  Appends rather than replaces, so a task accumulates its own history. Use
  \`tasks update --notes=\` to overwrite instead.

  tasks note 7 "Root cause: redirectTo is double-encoded."`,

  remove: `tasks remove <id> — delete a task

  Prints the title and asks for confirmation (\`y\` on stdin) before deleting — a typo'd
  number is a valid id far more often than a typo'd opaque one ever was.

  --force                    skip the prompt, e.g. from a script or an agent

  tasks remove 7
  tasks remove 7 --force`,

  status: `tasks status — list or change the project's columns

  The columns are per-project, kept in .tasks/config.json and ordered left to right on
  the board. Agents: read them, do not assume them — the four defaults are a starting
  point, not the schema.

  list                       print the statuses in board order (--json for an array)
  add <name>                 add a column; --after=<status> or --before=<status> to
                             place it, otherwise it goes last
  rename <old> <new>         rename a column, moving its tasks with it in one write
  reorder <name>             move a column; --after=<status> or --before=<status>
  remove <name>              delete a column; --move-to=<status> says where its tasks
                             go, required unless the column is empty

  tasks status list
  tasks status add review --after=in-progress
  tasks status rename priority next-up
  tasks status remove review --move-to=backlog`,

  'migrate-ids': `tasks migrate-ids — convert a store's pre-prefix task IDs

  One-shot: renumbers every old-format id to <prefix>-<n> in the order tasks were
  created, and rewrites every cross-reference to one of them found in a title or notes
  body. Safe to run again — an id already using the target prefix is left alone.

  --prefix=<name>, -p <name>  defaults to this store's config if it has one, or to the
                             repository's own name otherwise

  tasks migrate-ids
  tasks migrate-ids --prefix=tt`,
};
