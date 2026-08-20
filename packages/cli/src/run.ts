import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  STORE_DIR_NAME,
  TASK_STATUSES,
  TaskValidationError,
  createJsonlStore,
  createStoreDir,
  findStoreDir,
  isTaskStatus,
  parseDraft,
  parsePatch,
  storeFilePath,
} from '@task-tracker/core';
import type { Task, TaskFilter, TaskStatus, TaskStore } from '@task-tracker/core';
import { UsageError, flagList, flagSet, flagValue, parseArgs, rejectUnknownFlags } from './args.ts';
import type { ParsedArgs } from './args.ts';
import { formatJson, formatList, formatSummary, formatTask } from './format.ts';
import { installSkill } from './skill.ts';
import { COMMAND_HELP, USAGE } from './help.ts';

/**
 * Command dispatch.
 *
 * `run` takes its output sinks and working directory as arguments rather than reaching
 * for `process` directly. That is what makes every verb testable without spawning a
 * subprocess, and it is why `index.ts` is a handful of lines.
 *
 * Exit codes: 0 success, 1 the request was understood but could not be carried out,
 * 2 the request was malformed. Agents branch on these, so they must stay stable.
 */

export interface Io {
  out(text: string): void;
  err(text: string): void;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

export async function run(argv: readonly string[], io: Io, cwd: string): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return report(io, error);
  }

  if (args.command === undefined) {
    io.out(flagSet(args, 'version') ? VERSION : USAGE);
    return EXIT_OK;
  }

  const help = COMMAND_HELP[args.command];
  if (flagSet(args, 'help')) {
    io.out(help ?? USAGE);
    return EXIT_OK;
  }

  try {
    if (help === undefined) {
      throw new UsageError(
        `'${args.command}' is not a command. Available: ${Object.keys(COMMAND_HELP).join(', ')}.`,
      );
    }
    const directory = resolve(cwd, flagValue(args, 'C') ?? '.');
    return await dispatch(args.command, args, io, directory);
  } catch (error) {
    return report(io, error);
  }
}

async function dispatch(
  command: string,
  args: ParsedArgs,
  io: Io,
  directory: string,
): Promise<number> {
  if (command === 'init') return init(args, io, directory);

  const store = await openStore(directory);
  switch (command) {
    case 'add':
      return add(args, io, store);
    case 'list':
      return list(args, io, store);
    case 'show':
      return show(args, io, store);
    case 'update':
      return update(args, io, store);
    case 'move':
      return move(args, io, store);
    case 'note':
      return note(args, io, store);
    case 'remove':
      return remove(args, io, store);
    default:
      throw new UsageError(`'${command}' is not a command.`);
  }
}

// ---------------------------------------------------------------- commands

async function init(args: ParsedArgs, io: Io, directory: string): Promise<number> {
  rejectUnknownFlags(args, ['skip-skill'], 'init');

  // The skill goes in first: an agent that cannot find it does not know this CLI exists,
  // which makes an initialised store useless to the thing it is meant to be shared with.
  if (!flagSet(args, 'skip-skill')) {
    const skill = await installSkill();
    switch (skill.kind) {
      case 'installed':
        io.out(`Installed the agent skill at ${skill.path}`);
        io.out('  That is outside this project, and applies to every project.');
        break;
      case 'updated':
        io.out(`Updated the agent skill at ${skill.path}`);
        io.out(`  Your previous copy is at ${skill.backup}`);
        break;
      case 'current':
      case 'skipped':
        break;
    }
  }

  const existing = await findStoreDir(directory);
  const storeDir = await createStoreDir(directory);

  if (existing === storeDir) {
    io.out(`Task store already exists at ${storeDir}`);
    return EXIT_OK;
  }

  io.out(`Created ${storeDir}`);
  if (existing !== undefined) {
    io.out(`Note: there is another store at ${existing}. The nearest one wins.`);
  }

  const ignored = await ignoreStore(directory);
  if (ignored !== undefined) io.out(ignored);

  io.out('Add your first task:  tasks add "..."');
  return EXIT_OK;
}

async function add(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, ['category', 'tags', 'status', 'notes', 'refs'], 'add');

  const title = args.positionals.join(' ').trim();
  if (title === '') {
    throw new UsageError('add: a title is required, as `tasks add "Fix the thing"`.');
  }

  const draft = parseDraft(
    compact({
      title,
      notes: flagValue(args, 'notes'),
      category: flagValue(args, 'category'),
      tags: flagList(args, 'tags'),
      status: flagValue(args, 'status'),
      refs: flagList(args, 'refs'),
    }),
  );

  const task = await store.create(draft);
  emit(args, io, task, `Added ${task.id}  ${task.title}  (${task.status})`);
  return EXIT_OK;
}

async function list(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, ['status', 'category', 'tag', 'tags', 'query'], 'list');
  if (args.positionals.length > 0) {
    throw new UsageError(
      'list: takes no arguments — use flags to filter. See `tasks list --help`.',
    );
  }

  const filter: TaskFilter = {};
  const statuses = flagList(args, 'status');
  if (statuses !== undefined) filter.status = statuses.map(asStatus);

  const category = flagValue(args, 'category');
  if (category !== undefined) filter.category = category;

  const tags = flagList(args, 'tag') ?? flagList(args, 'tags');
  if (tags !== undefined) filter.tags = tags;

  const query = flagValue(args, 'query');
  if (query !== undefined) filter.query = query;

  const filtered = Object.keys(filter).length > 0;
  const tasks = await store.list(filter);

  if (flagSet(args, 'json')) {
    io.out(formatJson(tasks));
    return EXIT_OK;
  }

  if (tasks.length === 0) {
    io.out(filtered ? 'No tasks match that filter.' : 'No tasks yet. Add one:  tasks add "..."');
    return EXIT_OK;
  }

  io.out(formatList(tasks));
  if (!filtered) io.out(`\n${formatSummary(tasks)}`);
  return EXIT_OK;
}

async function show(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, [], 'show');
  const task = await requireTask(store, oneId(args, 'show'));
  io.out(flagSet(args, 'json') ? formatJson(task) : formatTask(task));
  return EXIT_OK;
}

async function update(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, ['title', 'category', 'tags', 'status', 'notes', 'refs'], 'update');
  const id = oneId(args, 'update');

  const patch = parsePatch(
    compact({
      title: flagValue(args, 'title'),
      notes: flagValue(args, 'notes'),
      category: flagValue(args, 'category'),
      tags: flagList(args, 'tags'),
      status: flagValue(args, 'status'),
      refs: flagList(args, 'refs'),
    }),
  );

  const task = await store.update(id, patch);
  emit(args, io, task, `Updated ${task.id}  ${task.title}`);
  return EXIT_OK;
}

async function move(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, ['after', 'before'], 'move');

  const [id, status, ...rest] = args.positionals;
  if (id === undefined || status === undefined || rest.length > 0) {
    throw new UsageError(
      `move: expected \`tasks move <id> <status>\`. Statuses: ${TASK_STATUSES.join(', ')}.`,
    );
  }

  const after = flagValue(args, 'after');
  const before = flagValue(args, 'before');
  const position: { after?: string; before?: string } = {};
  if (after !== undefined) position.after = after;
  if (before !== undefined) position.before = before;

  const task = await store.move(
    id,
    asStatus(status),
    Object.keys(position).length > 0 ? position : undefined,
  );
  emit(args, io, task, `Moved ${task.id} to ${task.status}  ${task.title}`);
  return EXIT_OK;
}

async function note(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, [], 'note');

  const [id, ...rest] = args.positionals;
  const text = rest.join(' ').trim();
  if (id === undefined || text === '') {
    throw new UsageError('note: expected `tasks note <id> "what you learned"`.');
  }

  const existing = await requireTask(store, id);
  const notes = existing.notes.trim() === '' ? text : `${existing.notes.trimEnd()}\n\n${text}`;

  const task = await store.update(id, { notes });
  emit(args, io, task, `Noted on ${task.id}  ${task.title}`);
  return EXIT_OK;
}

async function remove(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  rejectUnknownFlags(args, [], 'remove');
  const task = await requireTask(store, oneId(args, 'remove'));
  await store.remove(task.id);
  io.out(`Removed ${task.id}  ${task.title}`);
  return EXIT_OK;
}

// ---------------------------------------------------------------- helpers

const VERSION = '0.0.0';

class StoreMissingError extends Error {
  override readonly name = 'StoreMissingError';
}

async function openStore(directory: string): Promise<TaskStore> {
  const storeDir = await findStoreDir(directory);
  if (storeDir === undefined) {
    throw new StoreMissingError(
      `No ${STORE_DIR_NAME}/ directory at or above ${directory}. Run \`tasks init\` in the project root to create one.`,
    );
  }
  return createJsonlStore(storeFilePath(storeDir));
}

/**
 * Adds the store to .gitignore where that makes sense, and reports what it did.
 *
 * Creating a .gitignore in a project that is not a git repo would be presumptuous, so
 * that case says so instead of acting.
 */
async function ignoreStore(directory: string): Promise<string | undefined> {
  const entry = `${STORE_DIR_NAME}/`;
  const gitignore = join(directory, '.gitignore');

  let contents: string | undefined;
  try {
    contents = await readFile(gitignore, 'utf8');
  } catch {
    contents = undefined;
  }

  if (contents !== undefined) {
    const already = contents
      .split('\n')
      .some((line) => line.trim() === entry || line.trim() === STORE_DIR_NAME);
    if (already) return undefined;

    const separator = contents === '' || contents.endsWith('\n') ? '' : '\n';
    await writeFile(gitignore, `${contents}${separator}${entry}\n`, 'utf8');
    return `Added ${entry} to .gitignore`;
  }

  if (!(await exists(join(directory, '.git')))) {
    return 'Not a git repo, so nothing was added to .gitignore. Tasks are meant to stay local.';
  }

  await writeFile(gitignore, `${entry}\n`, 'utf8');
  return `Created .gitignore with ${entry}`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function asStatus(value: string): TaskStatus {
  if (!isTaskStatus(value)) {
    throw new UsageError(`'${value}' is not a status. Use one of: ${TASK_STATUSES.join(', ')}.`);
  }
  return value;
}

function oneId(args: ParsedArgs, command: string): string {
  const [id, ...rest] = args.positionals;
  if (id === undefined || rest.length > 0) {
    throw new UsageError(`${command}: expected exactly one task ID.`);
  }
  return id;
}

async function requireTask(store: TaskStore, id: string): Promise<Task> {
  const task = await store.get(id);
  if (task === undefined) {
    throw new TaskValidationError(
      `No task with ID '${id}'. Run \`tasks list\` to see the IDs that exist.`,
      'id',
    );
  }
  return task;
}

/** Drops absent flags so they stay absent, rather than becoming explicit undefineds. */
function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function emit(args: ParsedArgs, io: Io, task: Task, message: string): void {
  io.out(flagSet(args, 'json') ? formatJson(task) : message);
}

function report(io: Io, error: unknown): number {
  if (error instanceof UsageError) {
    io.err(error.message);
    return EXIT_USAGE;
  }
  io.err(error instanceof Error ? error.message : String(error));
  return EXIT_FAILED;
}
