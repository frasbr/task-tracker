import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { nextId } from './ids.ts';
import { needsRenumber, rankBetween, renumberRanks } from './rank.ts';
import { TASK_STATUSES } from './task.ts';
import type { Task, TaskStatus } from './task.ts';
import { TASK_FIELDS, TaskValidationError, parseTask } from './validate.ts';
import type { TaskDraft, TaskFilter, TaskPatch, TaskStore } from './store.ts';

/**
 * The JSONL store. One task per line, one file per project.
 *
 * Two properties are load-bearing:
 *
 * **Atomic writes.** Every save writes a temporary file, flushes it to disk, and
 * renames it over the real one. Rename is atomic on every platform we care about, so a
 * crash or a second writer landing mid-save can never leave a half-written store — the
 * worst case is that one of two concurrent writes is lost, which is the last-write-wins
 * behaviour PLAN.md accepts.
 *
 * **Canonical order.** Lines are sorted by column then rank, and fields are written in
 * a fixed order. That makes the file readable top-to-bottom, keeps diffs meaningful,
 * and means a `grep` for a task returns something a human can parse.
 */

const STATUS_ORDER = new Map<TaskStatus, number>(
  TASK_STATUSES.map((status, index) => [status, index]),
);

export function createJsonlStore(file: string): TaskStore {
  return new JsonlStore(file);
}

class JsonlStore implements TaskStore {
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  async list(filter?: TaskFilter): Promise<Task[]> {
    const tasks = await this.#read();
    return filter ? tasks.filter((task) => matches(task, filter)) : tasks;
  }

  async get(id: string): Promise<Task | undefined> {
    const tasks = await this.#read();
    return tasks.find((task) => task.id === id);
  }

  async create(draft: TaskDraft): Promise<Task> {
    const tasks = await this.#read();
    const now = new Date().toISOString();
    const column = tasks.filter((task) => task.status === draft.status);

    const task: Task = {
      id: nextId(new Set(tasks.map((existing) => existing.id))),
      title: draft.title,
      notes: draft.notes,
      category: draft.category,
      tags: draft.tags,
      status: draft.status,
      rank: draft.rank ?? rankBetween(column.at(-1)?.rank ?? null, null),
      created: now,
      updated: now,
      refs: draft.refs,
    };

    return this.#writeAndReturn([...tasks, task], task.id);
  }

  async update(id: string, patch: TaskPatch): Promise<Task> {
    const tasks = await this.#read();
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

    return this.#writeAndReturn(
      tasks.map((task) => (task.id === id ? updated : task)),
      id,
    );
  }

  async move(
    id: string,
    status: TaskStatus,
    position?: { after?: string; before?: string },
  ): Promise<Task> {
    const tasks = await this.#read();
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
    );
  }

  async remove(id: string): Promise<void> {
    const tasks = await this.#read();
    this.#require(tasks, id);
    await this.#write(tasks.filter((task) => task.id !== id));
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

  async #read(): Promise<Task[]> {
    let contents: string;
    try {
      contents = await readFile(this.#file, 'utf8');
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }

    const tasks: Task[] = [];
    const seen = new Set<string>();
    const lines = contents.split('\n');

    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue;
      const where = `${this.#file}:${index + 1}`;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new TaskValidationError(
          `${where}: not valid JSON. Each line of the store is one complete task object. If this file was edited by hand, that is the likely cause.`,
        );
      }

      const task = parseTask(parsed, where);
      if (seen.has(task.id)) {
        throw new TaskValidationError(`${where}: duplicate task ID '${task.id}'.`, 'id');
      }
      seen.add(task.id);
      tasks.push(task);
    }

    return tasks.sort(byColumnThenRank);
  }

  /**
   * Writes, then hands back the task as it was actually stored.
   *
   * Callers must not return the object they built: normalisation and column
   * renumbering can both change it, and a return value that disagrees with the file
   * is exactly the kind of drift that is impossible to debug later.
   */
  async #writeAndReturn(tasks: readonly Task[], id: string): Promise<Task> {
    const written = await this.#write(tasks);
    const task = written.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskValidationError(`Task '${id}' vanished during the write.`, 'id');
    }
    return task;
  }

  /**
   * Validating here as well as on read is deliberate. Without it a bad value reaches
   * disk and only fails the *next* time the store is opened, by which point the caller
   * that wrote it is long gone.
   */
  async #write(tasks: readonly Task[]): Promise<Task[]> {
    const ordered = [...tasks].sort(byColumnThenRank);
    const settled = renumberExhaustedColumns(ordered);
    const validated = settled.map((task, index) => parseTask(task, `${this.#file}:${index + 1}`));
    const body = validated.map(serialise).join('\n');
    await writeAtomically(this.#file, validated.length > 0 ? `${body}\n` : '');
    return validated;
  }
}

// ---------------------------------------------------------------- helpers

function byRank(a: Task, b: Task): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
}

function byColumnThenRank(a: Task, b: Task): number {
  const columns = STATUS_ORDER.get(a.status)! - STATUS_ORDER.get(b.status)!;
  return columns !== 0 ? columns : byRank(a, b);
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
 * This is the renumbering trigger PLAN.md calls for. It runs on every write, which is
 * cheap because the check is a length comparison and the rebuild almost never fires.
 */
function renumberExhaustedColumns(tasks: readonly Task[]): Task[] {
  const result = [...tasks];

  for (const status of TASK_STATUSES) {
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
 * Write, flush, rename. The temporary file is created beside the target so the rename
 * stays within one filesystem, which is what makes it atomic.
 */
async function writeAtomically(file: string, contents: string): Promise<void> {
  const temp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  const handle = await open(temp, 'wx');

  try {
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }

  try {
    await rename(temp, file);
  } catch (error) {
    await unlink(temp).catch(() => {});
    throw error;
  }
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
