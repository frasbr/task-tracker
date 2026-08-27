import { execFile } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  DEFAULT_PREFIX,
  DEFAULT_STATUSES,
  STORE_DIR_NAME,
  TaskValidationError,
  checkPrefix,
  createJsonlStore,
  createStoreDir,
  findStoreDir,
  formatId,
  formatTaskDocument,
  isTaskStatus,
  migrateStore,
  parseDraft,
  parseId,
  parsePatch,
  parseTaskDocument,
  readConfig,
  sanitizePrefix,
  storeFilePath,
  writeConfig,
} from '@task-tracker/core';
import type {
  ProjectConfig,
  Task,
  TaskFilter,
  TaskPatch,
  TaskStatus,
  TaskStore,
} from '@task-tracker/core';
import { UsageError, flagList, flagSet, flagValue, parseArgs, rejectUnknownFlags } from './args.ts';
import type { ParsedArgs } from './args.ts';
import { formatJson, formatList, formatSummary, formatTask } from './format.ts';
import { PLANS_DIR, PLAN_TEMPLATE_NAME, installPlanTemplate } from './plans.ts';
import { installSkills, skillsHome } from './skill.ts';
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
  /**
   * Standard input, read in full. Optional because most verbs never ask for it — only
   * `update --markdown` does, and a caller that cannot supply one gets told so rather
   * than hanging on a stream that will never arrive.
   */
  input?(): Promise<string>;
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
  if (command === 'migrate-ids') return migrateIdsCommand(args, io, directory);

  const { store, config } = await openStore(directory);
  switch (command) {
    case 'add':
      return add(args, io, store, config);
    case 'list':
      return list(args, io, store, config);
    case 'show':
      return show(args, io, store, config);
    case 'update':
      return update(args, io, store, config);
    case 'move':
      return move(args, io, store, config);
    case 'note':
      return note(args, io, store, config);
    case 'remove':
      return remove(args, io, store, config);
    case 'status':
      return status(args, io, store);
    default:
      throw new UsageError(`'${command}' is not a command.`);
  }
}

// ---------------------------------------------------------------- commands

async function init(args: ParsedArgs, io: Io, directory: string): Promise<number> {
  rejectUnknownFlags(args, ['skip-skill', 'skip-plans', 'prefix'], 'init');

  // The skills go in first: an agent that cannot find them does not know this CLI exists,
  // which makes an initialised store useless to the thing it is meant to be shared with.
  if (!flagSet(args, 'skip-skill')) {
    const outcomes = await installSkills();

    const installed = outcomes.filter((outcome) => outcome.kind === 'installed');
    if (installed.length > 0) {
      const names = installed.map((outcome) => outcome.name).join(', ');
      io.out(
        installed.length === 1
          ? `Installed the '${names}' agent skill in ${skillsHome()}`
          : `Installed the agent skills in ${skillsHome()}: ${names}`,
      );
      io.out('  That is outside this project, and applies to every project.');
    }

    for (const outcome of outcomes) {
      if (outcome.kind !== 'updated') continue;
      io.out(`Updated the '${outcome.name}' agent skill at ${outcome.path}`);
      io.out(`  Your previous copy is at ${outcome.backup}`);
    }
  }

  // Plans go in before the store check below, so an existing project adopts the convention
  // by re-running init rather than by being told it is already set up.
  if (!flagSet(args, 'skip-plans')) {
    const plans = await installPlanTemplate(directory);
    if (plans.kind === 'created') {
      io.out(`Created ${PLANS_DIR}/ and a plan template in it`);
      io.out(
        `  Copy ${PLAN_TEMPLATE_NAME} to ${PLANS_DIR}/0001-<slug>.md to start one. Plans hold the`,
      );
      io.out('  reasoning; the board holds the state. Point a task at its plan with --refs.');
    }
  }

  const existing = await findStoreDir(directory);
  const storeDir = await createStoreDir(directory);

  if (existing === storeDir) {
    io.out(`Task store already exists at ${storeDir}`);
    if (flagValue(args, 'prefix') !== undefined) {
      io.out(
        'The prefix is set once, at creation. To change an existing one, run `tasks migrate-ids`.',
      );
    }
    return EXIT_OK;
  }

  io.out(`Created ${storeDir}`);
  if (existing !== undefined) {
    io.out(`Note: there is another store at ${existing}. The nearest one wins.`);
  }

  // `existing !== storeDir` above means this .tasks/ is brand new, so there is no
  // config yet and — critically — no tasks whose ids a config could disagree with.
  const explicitPrefix = flagValue(args, 'prefix');
  const prefix =
    explicitPrefix !== undefined ? checkedPrefix(explicitPrefix) : await defaultPrefix(directory);
  await writeConfig(storeDir, { prefix, nextId: 1, statuses: [...DEFAULT_STATUSES] });
  io.out(
    explicitPrefix === undefined
      ? `Using task ID prefix '${prefix}', from the project directory. Override with --prefix.`
      : `Using task ID prefix '${prefix}'.`,
  );

  const ignored = await ignoreStore(directory);
  if (ignored !== undefined) io.out(ignored);

  io.out('Add your first task:  tasks add "..."');
  return EXIT_OK;
}

/**
 * The one-shot conversion off legacy opaque ids. Deliberately does not go through
 * `openStore`'s `TaskStore` — the normal read path refuses a legacy store on sight (see
 * jsonl.ts), so this reaches for core's `migrateStore` directly instead.
 */
async function migrateIdsCommand(args: ParsedArgs, io: Io, directory: string): Promise<number> {
  rejectUnknownFlags(args, ['prefix'], 'migrate-ids');
  if (args.positionals.length > 0) {
    throw new UsageError(
      'migrate-ids: takes no arguments. Use --prefix to name the target prefix.',
    );
  }

  const storeDir = await requireStoreDir(directory);
  const existing = await readConfig(storeDir);
  const explicitPrefix = flagValue(args, 'prefix');

  const prefix =
    explicitPrefix !== undefined
      ? checkedPrefix(explicitPrefix)
      : (existing?.prefix ?? (await defaultPrefix(directory)));

  const migration = await migrateStore(storeFilePath(storeDir), prefix);

  if (migration.mapping.size === 0) {
    io.out(`Nothing to migrate — every task already uses prefix '${prefix}'.`);
    return EXIT_OK;
  }

  const count = migration.mapping.size;
  io.out(`Migrated ${count} task${count === 1 ? '' : 's'} to prefix '${prefix}':`);
  for (const [from, to] of migration.mapping) {
    io.out(`  ${from} → ${to}`);
  }
  return EXIT_OK;
}

async function add(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, ['category', 'tags', 'status', 'notes', 'refs', 'blocked-by'], 'add');

  const title = args.positionals.join(' ').trim();
  if (title === '') {
    throw new UsageError('add: a title is required, as `tasks add "Fix the thing"`.');
  }

  return rejectingBlockedByAsUsage(async () => {
    const draft = parseDraft(
      compact({
        title,
        notes: flagValue(args, 'notes'),
        category: flagValue(args, 'category'),
        tags: flagList(args, 'tags'),
        status: flagValue(args, 'status'),
        refs: flagList(args, 'refs'),
        blockedBy: flagList(args, 'blocked-by'),
      }),
      statusesOf(config),
    );

    const task = await store.create(draft);
    emit(args, io, task, `Added ${task.id}  ${task.title}  (${task.status})`);
    return EXIT_OK;
  });
}

async function list(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, ['status', 'category', 'tag', 'tags', 'query'], 'list');
  if (args.positionals.length > 0) {
    throw new UsageError(
      'list: takes no arguments — use flags to filter. See `tasks list --help`.',
    );
  }

  const filter: TaskFilter = {};
  const wanted = flagList(args, 'status');
  if (wanted !== undefined) filter.status = wanted.map((s) => asStatus(s, statusesOf(config)));

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
  if (!filtered) io.out(`\n${formatSummary(tasks, statusesOf(config))}`);
  return EXIT_OK;
}

async function show(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, ['markdown'], 'show');
  const task = await requireTask(store, requiredId(args, 'show', config));

  if (flagSet(args, 'markdown')) {
    // Already newline-terminated, and `io.out` adds one of its own; trailing blank
    // lines matter to whoever is about to edit this in a buffer.
    io.out(formatTaskDocument(task).trimEnd());
    return EXIT_OK;
  }

  io.out(flagSet(args, 'json') ? formatJson(task) : formatTask(task));
  return EXIT_OK;
}

const UPDATE_FIELD_FLAGS = [
  'title',
  'category',
  'tags',
  'status',
  'notes',
  'refs',
  'blocked-by',
] as const;

async function update(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, [...UPDATE_FIELD_FLAGS, 'markdown'], 'update');
  const id = requiredId(args, 'update', config);

  return rejectingBlockedByAsUsage(async () => {
    const patch = flagSet(args, 'markdown')
      ? await patchFromDocument(args, io, id, config)
      : parsePatch(
          compact({
            title: flagValue(args, 'title'),
            notes: flagValue(args, 'notes'),
            category: flagValue(args, 'category'),
            tags: flagList(args, 'tags'),
            status: flagValue(args, 'status'),
            refs: flagList(args, 'refs'),
            blockedBy: flagList(args, 'blocked-by'),
          }),
          statusesOf(config),
        );

    const task = await store.update(id, patch);
    emit(args, io, task, `Updated ${task.id}  ${task.title}`);
    return EXIT_OK;
  });
}

/**
 * `update --markdown`: the whole task, read from stdin as the document `show --markdown`
 * writes. This is how the extension saves an editor buffer, and it is deliberately the
 * same path a person gets with `tasks update <id> --markdown < task.md`.
 */
async function patchFromDocument(
  args: ParsedArgs,
  io: Io,
  id: string,
  config: ProjectConfig | undefined,
): Promise<TaskPatch> {
  const conflicting = UPDATE_FIELD_FLAGS.filter((flag) => args.flags.has(flag));
  if (conflicting.length > 0) {
    throw new UsageError(
      `update: --markdown carries every field, so it cannot be combined with ` +
        `${conflicting.map((flag) => `--${flag}`).join(', ')}.`,
    );
  }
  if (io.input === undefined) {
    throw new UsageError('update: --markdown reads the document from stdin, which is unavailable.');
  }

  const document = parseTaskDocument(await io.input(), statusesOf(config), 'update');

  // A document carries the id it was rendered from. Disagreeing with the argument means
  // text was pasted between tasks, and writing it anyway would overwrite the wrong one.
  if (document.id !== undefined && document.id !== id) {
    throw new UsageError(
      `update: this document is task '${document.id}', but you asked to update '${id}'.`,
    );
  }

  return document.patch;
}

async function move(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, ['after', 'before'], 'move');

  const [rawId, status, ...rest] = args.positionals;
  if (rawId === undefined || status === undefined || rest.length > 0) {
    throw new UsageError(
      `move: expected \`tasks move <id> <status>\`. Statuses: ${statusesOf(config).join(', ')}.`,
    );
  }
  const id = resolveId(rawId, config);

  const after = flagValue(args, 'after');
  const before = flagValue(args, 'before');
  const position: { after?: string; before?: string } = {};
  if (after !== undefined) position.after = resolveId(after, config);
  if (before !== undefined) position.before = resolveId(before, config);

  const task = await store.move(
    id,
    asStatus(status, statusesOf(config)),
    Object.keys(position).length > 0 ? position : undefined,
  );
  emit(args, io, task, `Moved ${task.id} to ${task.status}  ${task.title}`);
  return EXIT_OK;
}

async function note(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, [], 'note');

  const [rawId, ...rest] = args.positionals;
  const text = rest.join(' ').trim();
  if (rawId === undefined || text === '') {
    throw new UsageError('note: expected `tasks note <id> "what you learned"`.');
  }
  const id = resolveId(rawId, config);

  const existing = await requireTask(store, id);
  const notes = existing.notes.trim() === '' ? text : `${existing.notes.trimEnd()}\n\n${text}`;

  const task = await store.update(id, { notes });
  emit(args, io, task, `Noted on ${task.id}  ${task.title}`);
  return EXIT_OK;
}

async function remove(
  args: ParsedArgs,
  io: Io,
  store: TaskStore,
  config: ProjectConfig | undefined,
): Promise<number> {
  rejectUnknownFlags(args, ['force'], 'remove');
  const task = await requireTask(store, requiredId(args, 'remove', config));

  if (!flagSet(args, 'force')) {
    if (io.input === undefined) {
      throw new UsageError(
        `remove: refusing to delete '${task.id}  ${task.title}' without confirmation. Pass --force to skip the prompt, e.g. from a script.`,
      );
    }
    io.out(`Remove ${task.id}  ${task.title}? [y/N]`);
    const answer = (await io.input()).trim().toLowerCase();
    if (answer !== 'y' && answer !== 'yes') {
      io.out('Aborted. Nothing was removed.');
      return EXIT_OK;
    }
  }

  await store.remove(task.id);
  io.out(`Removed ${task.id}  ${task.title}`);
  return EXIT_OK;
}

/**
 * `tasks status …` — the only way a project's columns change. Every subcommand routes to
 * a core store method that owns the atomic write; this handler only parses arguments and
 * reports. Semantic failures (an unknown status, a non-empty column removed without a
 * destination) are the store's to raise, so their rules live in one place.
 */
async function status(args: ParsedArgs, io: Io, store: TaskStore): Promise<number> {
  const [sub, ...rest] = args.positionals;

  switch (sub) {
    case undefined:
    case 'list': {
      rejectUnknownFlags(args, [], 'status list');
      const statuses = await store.listStatuses();
      io.out(flagSet(args, 'json') ? JSON.stringify(statuses) : statuses.join('\n'));
      return EXIT_OK;
    }
    case 'add': {
      rejectUnknownFlags(args, ['after', 'before'], 'status add');
      const name = oneStatusName(rest, 'status add', '<name>');
      const statuses = await store.addStatus(name, positionFrom(args));
      io.out(`Added status '${name}'.  ${statuses.join(' · ')}`);
      return EXIT_OK;
    }
    case 'rename': {
      rejectUnknownFlags(args, [], 'status rename');
      const [from, to, ...extra] = rest;
      if (from === undefined || to === undefined || extra.length > 0) {
        throw new UsageError('status rename: expected `tasks status rename <old> <new>`.');
      }
      const statuses = await store.renameStatus(from, to);
      io.out(`Renamed '${from}' to '${to}'.  ${statuses.join(' · ')}`);
      return EXIT_OK;
    }
    case 'reorder': {
      rejectUnknownFlags(args, ['after', 'before'], 'status reorder');
      const name = oneStatusName(rest, 'status reorder', '<name> [--after=|--before=]');
      const statuses = await store.reorderStatus(name, positionFrom(args));
      io.out(`Reordered.  ${statuses.join(' · ')}`);
      return EXIT_OK;
    }
    case 'remove': {
      rejectUnknownFlags(args, ['move-to'], 'status remove');
      const name = oneStatusName(rest, 'status remove', '<name> [--move-to=<status>]');
      const statuses = await store.removeStatus(name, flagValue(args, 'move-to'));
      io.out(`Removed status '${name}'.  ${statuses.join(' · ')}`);
      return EXIT_OK;
    }
    default:
      throw new UsageError(
        `status: '${sub}' is not a subcommand. Use list, add, rename, reorder or remove.`,
      );
  }
}

/** The single status name a `status` subcommand takes, or a usage error naming the shape. */
function oneStatusName(positionals: readonly string[], command: string, shape: string): string {
  const [name, ...extra] = positionals;
  if (name === undefined || extra.length > 0) {
    throw new UsageError(`${command}: expected \`tasks ${command} ${shape}\`.`);
  }
  return name;
}

/** Reads `--after`/`--before` into a position, or `undefined` when neither is given. */
function positionFrom(args: ParsedArgs): { after?: string; before?: string } | undefined {
  const after = flagValue(args, 'after');
  const before = flagValue(args, 'before');
  if (after === undefined && before === undefined) return undefined;
  const position: { after?: string; before?: string } = {};
  if (after !== undefined) position.after = after;
  if (before !== undefined) position.before = before;
  return position;
}

// ---------------------------------------------------------------- helpers

const VERSION = '0.0.0';

class StoreMissingError extends Error {
  override readonly name = 'StoreMissingError';
}

async function openStore(
  directory: string,
): Promise<{ store: TaskStore; config: ProjectConfig | undefined }> {
  const storeDir = await requireStoreDir(directory);
  const config = await readConfig(storeDir);
  return { store: createJsonlStore(storeFilePath(storeDir)), config };
}

async function requireStoreDir(directory: string): Promise<string> {
  const storeDir = await findStoreDir(directory);
  if (storeDir === undefined) {
    throw new StoreMissingError(
      `No ${STORE_DIR_NAME}/ directory at or above ${directory}. Run \`tasks init\` in the project root to create one.`,
    );
  }
  return storeDir;
}

/**
 * A bare number is shorthand for this project's own prefix; a qualified id from a
 * different project is refused rather than coerced, since that is someone pasting an id
 * from another repo, not a typo. With no config yet — a store nothing has ever written
 * to — there is no prefix to interpret a bare number against, so it is passed through
 * unchanged and simply will not resolve to a task, which is the correct outcome: with
 * nothing in the store yet, no id can be valid anyway.
 */
function resolveId(raw: string, config: ProjectConfig | undefined): string {
  if (config === undefined) return raw;

  if (/^\d+$/.test(raw)) return formatId(config.prefix, Number(raw));

  const parsed = parseId(raw);
  if (parsed !== undefined && parsed.prefix !== config.prefix) {
    throw new UsageError(
      `'${raw}' belongs to a different project (prefix '${parsed.prefix}'; this one is '${config.prefix}'). ` +
        `If you pasted this from another repo, run this command there instead.`,
    );
  }
  return raw;
}

function requiredId(args: ParsedArgs, command: string, config: ProjectConfig | undefined): string {
  return resolveId(oneId(args, command), config);
}

/** Sanitises and validates a user-supplied `--prefix`, turning a bad one into a UsageError. */
function checkedPrefix(input: string): string {
  const prefix = sanitizePrefix(input);
  try {
    checkPrefix(prefix);
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  return prefix;
}

/**
 * `blockedBy` is the field the plan calls a malformed request, not merely one that could
 * not be carried out: an unknown id, a cycle, and a bad id shape are all exit 2. All
 * three surface as `TaskValidationError` tagged `field: 'blockedBy'` — the shape check in
 * validate.ts throws before the store is ever touched, and the whole-store
 * existence/cycle check in `checkPrerequisites` (packages/core/src/prerequisites.ts)
 * throws from inside `store.create`/`store.update`. Catching both here and re-throwing as
 * `UsageError` — the same move `checkedPrefix` below makes for `checkPrefix` — gets
 * `blockedBy` to exit 2 without moving every other `TaskValidationError` (an unknown
 * field, an empty title) off the exit 1 they exit today and run.test.ts asserts.
 */
async function rejectingBlockedByAsUsage<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof TaskValidationError && error.field === 'blockedBy') {
      throw new UsageError(error.message);
    }
    throw error;
  }
}

/**
 * The repository's own name, sanitised into a prefix. A bad result here (say, a repo
 * named entirely in digits) falls back to the default rather than erroring — nobody
 * typed this value, so there is nothing for them to fix.
 */
async function defaultPrefix(directory: string): Promise<string> {
  const prefix = sanitizePrefix(await repoName(directory));
  try {
    checkPrefix(prefix);
    return prefix;
  } catch {
    return DEFAULT_PREFIX;
  }
}

const execFileAsync = promisify(execFile);

async function repoName(directory: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], {
      cwd: directory,
    });
    return basename(stdout.trim());
  } catch {
    return basename(resolve(directory));
  }
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

/** The project's configured statuses, or the defaults for a store with no config yet. */
function statusesOf(config: ProjectConfig | undefined): string[] {
  return config?.statuses ?? [...DEFAULT_STATUSES];
}

function asStatus(value: string, statuses: readonly string[]): TaskStatus {
  if (!isTaskStatus(value, statuses)) {
    throw new UsageError(`'${value}' is not a status. Use one of: ${statuses.join(', ')}.`);
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
