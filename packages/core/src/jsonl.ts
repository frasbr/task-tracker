import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeFileAtomically } from './atomic.ts';
import { ConfigError, DEFAULT_PREFIX, checkStatusList, readConfig, writeConfig } from './config.ts';
import type { ProjectConfig } from './config.ts';
import { formatId, isLegacyId } from './ids.ts';
import type { IdMigration } from './migrate.ts';
import { migrateIds } from './migrate.ts';
import { checkPrerequisites } from './prerequisites.ts';
import { needsRenumber, rankBetween, renumberRanks } from './rank.ts';
import { DEFAULT_STATUSES } from './task.ts';
import type { Task, TaskStatus } from './task.ts';
import { TASK_FIELDS, TaskValidationError, parseTask } from './validate.ts';
import type { StatusPosition, TaskDraft, TaskFilter, TaskPatch, TaskStore } from './store.ts';

/**
 * The JSONL store. One task per line, one file per project.
 *
 * Two crucial properties:
 *
 * **Atomic writes.** Every save writes a temporary file, flushes it to disk, and
 * renames it over the real one. Rename is atomic on every platform we care about, so a
 * crash or a second writer landing mid-save can never leave a half-written store — the
 * worst case is that one of two concurrent writes is lost, which is the last-write-wins
 * behaviour this design accepts.
 *
 * **Canonical order.** Lines are sorted by column then rank, and fields are written in
 * a fixed order. That makes the file readable top-to-bottom, keeps diffs meaningful,
 * and means a `grep` for a task returns something a human can parse.
 */

export function createJsonlStore(file: string): TaskStore {
  return new JsonlStore(file);
}

class JsonlStore implements TaskStore {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    const { tasks } = await this.#read();
    return filter ? tasks.filter((task) => matches(task, filter)) : tasks;
  }

  async get(id: string): Promise<Task | undefined> {
    const { tasks } = await this.#read();
    return tasks.find((task) => task.id === id);
  }

  async create(draft: TaskDraft): Promise<Task> {
    const { tasks, config } = await this.#read();
    const now = new Date().toISOString();
    const column = tasks.filter((task) => task.status === draft.status);

    const id = formatId(config.prefix, config.nextId);
    const task: Task = {
      id,
      title: draft.title,
      notes: draft.notes,
      category: draft.category,
      tags: draft.tags,
      status: draft.status,
      rank: draft.rank ?? rankBetween(column.at(-1)?.rank ?? null, null),
      created: now,
      updated: now,
      refs: draft.refs,
      blockedBy: draft.blockedBy,
    };
    // Checked before the counter is spent, so a bad blockedBy costs nothing but the
    // rejection — a brand new id cannot already be part of a cycle, only unknown.
    checkPrerequisites([...tasks, task], task.id);

    // The counter is written before the task it names: a crash between the two leaves
    // a gap in the numbering (harmless) rather than two tasks sharing a number (not).
    await writeConfig(dirname(this.#file), { ...config, nextId: config.nextId + 1 });

    return this.#writeAndReturn([...tasks, task], task.id, config.prefix, config.statuses);
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const { tasks, config } = await this.#read();
    const existing = this.#require(tasks, id);

    // Changing status through `update` still needs a position in the new column.
    // Appending is the least surprising choice; `move` is the way to place precisely.
    const movingColumn = patch.status !== undefined && patch.status !== existing.status;
    const rank =
      patch.rank ??
      (movingColumn
        ? rankBetween(lastRankIn(tasks, patch.status!, existing.id), null)
        : existing.rank);

    const updated: Task = {
      ...existing,
      ...patch,
      rank,
      updated: new Date().toISOString(),
    };
    const next = tasks.map((task) => (task.id === id ? updated : task));

    // Only when this patch actually touches blockedBy — an edge nobody is writing this
    // time is not this write's problem, and re-checking it would fail an unrelated field
    // update the moment some other task points at an id `remove` has already dropped
    // (dropping the pointer itself is tt-19, not this).
    if (patch.blockedBy !== undefined) checkPrerequisites(next, id);

    return this.#writeAndReturn(next, id, config.prefix, config.statuses);
  }

  async move(
    id: string,
    status: TaskStatus,
    position?: { after?: string; before?: string },
  ): Promise<Task> {
    const { tasks, config } = await this.#read();
    const existing = this.#require(tasks, id);

    const column = tasks.filter((task) => task.status === status && task.id !== id).sort(byRank);

    const { before, after } = resolveNeighbours(column, position, id);

    const moved: Task = {
      ...existing,
      status,
      rank: rankBetween(before, after),
      updated: new Date().toISOString(),
    };

    return this.#writeAndReturn(
      tasks.map((task) => (task.id === id ? moved : task)),
      id,
      config.prefix,
      config.statuses,
    );
  }

  async remove(id: string): Promise<void> {
    const { tasks, config } = await this.#read();
    this.#require(tasks, id);
    await writeTasks(
      this.#file,
      tasks
        .filter((task) => task.id !== id)
        // Same shape as renameStatus below: every task carrying a pointer to what is
        // about to disappear is rewritten in this write, so none is left naming a task
        // that no longer exists. `updated` is left alone for the same reason
        // renameStatus leaves it alone below — the edit belongs to whoever deleted the
        // prerequisite, not to a task that did not ask to change.
        .map((task) =>
          task.blockedBy.includes(id)
            ? { ...task, blockedBy: task.blockedBy.filter((blocked) => blocked !== id) }
            : task,
        ),
      config.prefix,
      config.statuses,
    );
  }

  async listStatuses(): Promise<string[]> {
    const { config } = await this.#read();
    return config.statuses;
  }

  async addStatus(name: string, position?: StatusPosition): Promise<string[]> {
    const { config } = await this.#read();
    if (config.statuses.includes(name.trim())) {
      throw new ConfigError(`A status named '${name.trim()}' already exists.`);
    }
    const statuses = checkStatusList(placeInList(config.statuses, name.trim(), position), 'config');
    await writeConfig(dirname(this.#file), { ...config, statuses });
    return statuses;
  }

  async renameStatus(from: string, to: string): Promise<string[]> {
    const { tasks, config } = await this.#read();
    requireStatus(config.statuses, from);

    const statuses = checkStatusList(
      config.statuses.map((status) => (status === from ? to.trim() : status)),
      'config',
    );

    // Config first, then the tasks it now describes — the same crash-ordering `create`
    // uses. A card is never left naming a column the config no longer lists.
    await writeConfig(dirname(this.#file), { ...config, statuses });
    await writeTasks(
      this.#file,
      tasks.map((task) => (task.status === from ? { ...task, status: to.trim() } : task)),
      config.prefix,
      statuses,
    );
    return statuses;
  }

  async reorderStatus(name: string, position?: StatusPosition): Promise<string[]> {
    const { config } = await this.#read();
    requireStatus(config.statuses, name);
    const statuses = checkStatusList(placeInList(config.statuses, name, position), 'config');
    await writeConfig(dirname(this.#file), { ...config, statuses });
    return statuses;
  }

  async removeStatus(name: string, moveTo?: string): Promise<string[]> {
    const { tasks, config } = await this.#read();
    requireStatus(config.statuses, name);

    const statuses = checkStatusList(
      config.statuses.filter((status) => status !== name),
      'config',
    );

    const inColumn = tasks.filter((task) => task.status === name).sort(byRank);
    if (inColumn.length > 0 && moveTo === undefined) {
      throw new ConfigError(
        `'${name}' still holds ${inColumn.length} task${inColumn.length === 1 ? '' : 's'}. ` +
          `Pass where they should go, e.g. --move-to=${statuses[0]}.`,
      );
    }

    if (inColumn.length === 0) {
      // Nothing to move: only the config changes. Every remaining task still names a
      // listed column, so the store file does not need rewriting.
      await writeConfig(dirname(this.#file), { ...config, statuses });
      return statuses;
    }

    if (!statuses.includes(moveTo!)) {
      throw new ConfigError(
        `Cannot move tasks to '${moveTo}': it is not a status here. Use one of: ${statuses.join(', ')}.`,
      );
    }

    // Fresh ranks at the end of the destination, in the tasks' current order — carrying
    // the old ranks across would interleave them wrongly with what is already there.
    let last =
      tasks
        .filter((task) => task.status === moveTo)
        .sort(byRank)
        .at(-1)?.rank ?? null;
    const reranked = new Map<string, string>();
    for (const task of inColumn) {
      last = rankBetween(last, null);
      reranked.set(task.id, last);
    }

    await writeConfig(dirname(this.#file), { ...config, statuses });
    await writeTasks(
      this.#file,
      tasks.map((task) =>
        task.status === name ? { ...task, status: moveTo!, rank: reranked.get(task.id)! } : task,
      ),
      config.prefix,
      statuses,
    );
    return statuses;
  }

  #require(tasks: readonly Task[], id: string): Task {
    const task = tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskValidationError(
        `No task with ID '${id}'. Run \`tasks list\` to see the IDs that exist.`,
        'id',
      );
    }
    return task;
  }

  /**
   * Reads the raw lines, then resolves the project's config before validating any of
   * them against it — the config decides what a valid id even looks like here.
   */
  async #read(): Promise<{ tasks: Task[]; config: ProjectConfig }> {
    const lines = await readRawLines(this.#file);
    const config = await this.#resolveConfig(lines);

    const tasks: Task[] = [];
    const seen = new Set<string>();
    for (const { where, parsed } of lines) {
      const task = parseTask(parsed, where, config.prefix, config.statuses);
      if (seen.has(task.id)) {
        throw new TaskValidationError(`${where}: duplicate task ID '${task.id}'.`, 'id');
      }
      seen.add(task.id);
      tasks.push(task);
    }

    return { tasks: tasks.sort(byColumnThenRank(statusOrder(config.statuses))), config };
  }

  /**
   * `.tasks/config.json` may not exist yet: a store with no tasks gets a fresh default
   * config the first time anything needs one, the same way an empty store has always
   * needed no ceremony. A store that already has tasks but no config predates phase 6 —
   * its ids only make sense once `tasks migrate-ids` has renumbered them, so that store
   * refuses to read rather than silently adopting a prefix nobody chose.
   */
  async #resolveConfig(lines: readonly RawLine[]): Promise<ProjectConfig> {
    const existing = await readConfig(dirname(this.#file));
    if (existing !== undefined) return existing;

    if (lines.length === 0) {
      const fresh: ProjectConfig = {
        prefix: DEFAULT_PREFIX,
        nextId: 1,
        statuses: [...DEFAULT_STATUSES],
      };
      await writeConfig(dirname(this.#file), fresh);
      return fresh;
    }

    if (looksLegacy(lines[0]!.parsed)) {
      throw new TaskValidationError(
        `${this.#file}: this store still has pre-incremental task IDs. Run \`tasks migrate-ids\` to convert them.`,
      );
    }

    throw new TaskValidationError(
      `${dirname(this.#file)}: missing config.json. Run \`tasks init\` to create one.`,
    );
  }

  async #writeAndReturn(
    tasks: readonly Task[],
    id: string,
    prefix: string,
    statuses: readonly string[],
  ): Promise<Task> {
    const written = await writeTasks(this.#file, tasks, prefix, statuses);
    const task = written.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskValidationError(`Task '${id}' vanished during the write.`, 'id');
    }
    return task;
  }
}

// ---------------------------------------------------------------- migration

/**
 * The one-shot conversion off legacy ids, for `tasks migrate-ids`. Reads every task
 * leniently (a legacy id is not a valid id for any prefix, so the normal read path
 * cannot be used here), renumbers, and writes the config and the store — config first,
 * for the same crash-ordering reason `create` writes it first.
 */
export async function migrateStore(file: string, prefix: string): Promise<IdMigration> {
  const lines = await readRawLines(file);
  const tasks = lines.map(({ where, parsed }) => parseTask(parsed, where, undefined));

  const migration = migrateIds(tasks, prefix);
  await writeConfig(dirname(file), migration.config);
  await writeTasks(file, migration.tasks, prefix, migration.config.statuses);

  return migration;
}

// ---------------------------------------------------------------- helpers

interface RawLine {
  where: string;
  parsed: unknown;
}

/** Reads the store file, JSON-parsing each non-blank line. Ids are not checked here. */
async function readRawLines(file: string): Promise<RawLine[]> {
  let contents: string;
  try {
    contents = await readFile(file, 'utf8');
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const lines: RawLine[] = [];
  for (const [index, line] of contents.split('\n').entries()) {
    if (line.trim() === '') continue;
    const where = `${file}:${index + 1}`;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new TaskValidationError(
        `${where}: not valid JSON. Each line of the store is one complete task object. If this file was edited by hand, that is the likely cause.`,
      );
    }
    lines.push({ where, parsed });
  }

  return lines;
}

/** Throws a listing error when `name` is not one of the project's statuses. */
function requireStatus(statuses: readonly string[], name: string): void {
  if (!statuses.includes(name)) {
    throw new ConfigError(`'${name}' is not a status here. Use one of: ${statuses.join(', ')}.`);
  }
}

/**
 * Returns `list` with `name` placed at `position` — after or before a named neighbour,
 * or at the end when neither is given. `name` is removed first, so this both inserts a
 * new status and reorders an existing one. A named neighbour that is not present is an
 * error rather than a silent append, since the caller was pointing at something.
 */
function placeInList(list: readonly string[], name: string, position?: StatusPosition): string[] {
  const without = list.filter((status) => status !== name);

  const anchor = position?.after ?? position?.before;
  if (anchor === undefined) return [...without, name];

  const index = without.indexOf(anchor);
  if (index < 0) {
    throw new ConfigError(`'${anchor}' is not a status here. Use one of: ${without.join(', ')}.`);
  }
  const at = position?.after !== undefined ? index + 1 : index;
  return [...without.slice(0, at), name, ...without.slice(at)];
}

function looksLegacy(parsed: unknown): boolean {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false;
  return isLegacyId((parsed as Record<string, unknown>)['id']);
}

function byRank(a: Task, b: Task): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
}

/** A status → column-index lookup, built from the project's configured order. */
function statusOrder(statuses: readonly string[]): Map<string, number> {
  return new Map(statuses.map((status, index) => [status, index]));
}

/**
 * Sorts by column, then by rank within it. Column order is the project's configured
 * status order. A status not in that order sorts after every configured one — a
 * transient state, since the write path validates each task against the same list.
 */
function byColumnThenRank(order: Map<string, number>): (a: Task, b: Task) => number {
  return (a, b) => {
    const columns = (order.get(a.status) ?? order.size) - (order.get(b.status) ?? order.size);
    return columns !== 0 ? columns : byRank(a, b);
  };
}

function lastRankIn(tasks: readonly Task[], status: TaskStatus, excludeId: string): string | null {
  const column = tasks
    .filter((task) => task.status === status && task.id !== excludeId)
    .sort(byRank);
  return column.at(-1)?.rank ?? null;
}

/**
 * Turns `{ after: 'tabc' }` or `{ before: 'tdef' }` into the pair of ranks the new key
 * must sit between. An absent position means "end of the column".
 */
function resolveNeighbours(
  column: readonly Task[],
  position: { after?: string; before?: string } | undefined,
  movingId: string,
): { before: string | null; after: string | null } {
  if (!position || (position.after === undefined && position.before === undefined)) {
    return { before: column.at(-1)?.rank ?? null, after: null };
  }

  const locate = (id: string): number => {
    const index = column.findIndex((task) => task.id === id);
    if (index < 0) {
      throw new TaskValidationError(
        id === movingId
          ? `Cannot position task '${id}' relative to itself.`
          : `Cannot position relative to task '${id}': it is not in that column.`,
        'id',
      );
    }
    return index;
  };

  if (position.after !== undefined && position.before !== undefined) {
    return {
      before: column[locate(position.after)]!.rank,
      after: column[locate(position.before)]!.rank,
    };
  }

  if (position.after !== undefined) {
    const index = locate(position.after);
    return { before: column[index]!.rank, after: column[index + 1]?.rank ?? null };
  }

  const index = locate(position.before!);
  return { before: column[index - 1]?.rank ?? null, after: column[index]!.rank };
}

/**
 * Rebuilds the ranks of any column whose keys have grown past the limit.
 *
 * This is the renumbering trigger rank exhaustion needs. It runs on every write, which is
 * cheap because the check is a length comparison and the rebuild almost never fires.
 */
function renumberExhaustedColumns(tasks: readonly Task[], statuses: readonly string[]): Task[] {
  const result = [...tasks];

  for (const status of statuses) {
    const indices = result
      .map((task, index) => ({ task, index }))
      .filter((entry) => entry.task.status === status);

    if (!needsRenumber(indices.map((entry) => entry.task.rank))) continue;

    const fresh = renumberRanks(indices.length);
    for (const [position, entry] of indices.entries()) {
      result[entry.index] = { ...entry.task, rank: fresh[position]! };
    }
  }

  return result;
}

/** One task as one line, with fields in a fixed order. */
function serialise(task: Task): string {
  const ordered: Record<string, unknown> = {};
  for (const field of TASK_FIELDS) {
    ordered[field] = task[field];
  }
  return JSON.stringify(ordered);
}

/**
 * Validates and writes a full task list, then hands back the tasks as they were
 * actually stored — normalisation and column renumbering can both change a task, and a
 * return value that disagrees with the file is exactly the kind of drift that is
 * impossible to debug later.
 *
 * Validating here as well as on read is deliberate. Without it a bad value reaches disk
 * and only fails the *next* time the store is opened, by which point the caller that
 * wrote it is long gone.
 */
async function writeTasks(
  file: string,
  tasks: readonly Task[],
  prefix: string,
  statuses: readonly string[],
): Promise<Task[]> {
  const ordered = [...tasks].sort(byColumnThenRank(statusOrder(statuses)));
  const settled = renumberExhaustedColumns(ordered, statuses);
  const validated = settled.map((task, index) =>
    parseTask(task, `${file}:${index + 1}`, prefix, statuses),
  );
  const body = validated.map(serialise).join('\n');
  await writeFileAtomically(file, validated.length > 0 ? `${body}\n` : '');
  return validated;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

function matches(task: Task, filter: TaskFilter): boolean {
  if (filter.status !== undefined) {
    const wanted = Array.isArray(filter.status) ? filter.status : [filter.status];
    if (!wanted.includes(task.status)) return false;
  }
  if (filter.category !== undefined && task.category !== filter.category) return false;
  if (filter.tags !== undefined && !filter.tags.every((tag) => task.tags.includes(tag))) {
    return false;
  }
  if (filter.query !== undefined) {
    const needle = filter.query.toLowerCase();
    const haystack = `${task.title}\n${task.notes}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}
