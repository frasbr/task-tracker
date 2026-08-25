import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as vscode from 'vscode';
import { classifyCliError } from './interpret.ts';
import type { BoardProblem, BoardTask } from './protocol.ts';

/**
 * Running the `tasks` CLI.
 *
 * This is the extension's only route to task data. It spawns, reads `--json`, and turns
 * failures into the problem states the board knows how to render — it never parses the
 * store, and it never decides what a task means.
 *
 * The CLI's exit codes are a contract (see AGENTS.md): 1 means the request was
 * understood but could not be carried out, which is how "no store here yet" arrives.
 */

const run = promisify(execFile);

const MAX_OUTPUT = 16 * 1024 * 1024;

export type CliResult<T> = { ok: true; value: T } | { ok: false; problem: BoardProblem };

export function resolveCliPath(): string {
  const configured = vscode.workspace.getConfiguration('taskTracker').get<string>('cliPath');
  return configured !== undefined && configured.trim() !== '' ? configured.trim() : 'tasks';
}

export async function listTasks(directory: string): Promise<CliResult<BoardTask[]>> {
  const command = resolveCliPath();

  try {
    const { stdout } = await run(command, ['list', '--json'], {
      cwd: directory,
      maxBuffer: MAX_OUTPUT,
    });
    return { ok: true, value: JSON.parse(stdout) as BoardTask[] };
  } catch (error) {
    return { ok: false, problem: classify(error, command, directory) };
  }
}

/** The project's ordered status list, from `tasks status list --json`. */
export async function listStatuses(directory: string): Promise<CliResult<string[]>> {
  const result = await text(directory, ['status', 'list', '--json']);
  return result.ok ? { ok: true, value: JSON.parse(result.value) as string[] } : result;
}

/**
 * Adds a column via `tasks status add`. An empty `position` appends; the CLI owns name
 * validation, so a bad name comes back as a problem the caller surfaces rather than being
 * pre-checked here (AGENTS.md boundary 3).
 */
export async function addStatus(
  directory: string,
  name: string,
  position: { after?: string; before?: string } = {},
): Promise<CliResult<void>> {
  const args = ['status', 'add', name];
  if (position.after !== undefined) args.push(`--after=${position.after}`);
  if (position.before !== undefined) args.push(`--before=${position.before}`);
  const result = await text(directory, args);
  return result.ok ? { ok: true, value: undefined } : result;
}

/** Renames a column via `tasks status rename`, which carries its tasks along in one write. */
export async function renameStatus(
  directory: string,
  from: string,
  to: string,
): Promise<CliResult<void>> {
  const result = await text(directory, ['status', 'rename', from, to]);
  return result.ok ? { ok: true, value: undefined } : result;
}

/**
 * Removes a column via `tasks status remove`. `moveTo` is where its tasks go, required by
 * the CLI when the column is not empty; the caller asks for it before spawning.
 */
export async function removeStatus(
  directory: string,
  name: string,
  moveTo?: string,
): Promise<CliResult<void>> {
  const args = ['status', 'remove', name];
  if (moveTo !== undefined) args.push(`--move-to=${moveTo}`);
  const result = await text(directory, args);
  return result.ok ? { ok: true, value: undefined } : result;
}

/**
 * Everything a surface needs to draw the board: the tasks and the columns to lay them in.
 * Two spawns rather than one — the CLI has no combined verb — but a single result, so a
 * caller never renders tasks against a stale column list or vice versa. A failure in
 * either half is the one problem the caller shows.
 */
export async function loadBoard(
  directory: string,
): Promise<CliResult<{ tasks: BoardTask[]; statuses: string[] }>> {
  const tasks = await listTasks(directory);
  if (!tasks.ok) return tasks;
  const statuses = await listStatuses(directory);
  if (!statuses.ok) return statuses;
  return { ok: true, value: { tasks: tasks.value, statuses: statuses.value } };
}

/** One task as JSON. Used for the metadata an editor wants before it opens a document. */
export async function showTask(directory: string, id: string): Promise<CliResult<BoardTask>> {
  const result = await text(directory, ['show', id, '--json']);
  return result.ok ? { ok: true, value: JSON.parse(result.value) as BoardTask } : result;
}

/** One task as the editable document. The CLI owns this format; the extension only moves it. */
export async function showTaskDocument(directory: string, id: string): Promise<CliResult<string>> {
  return text(directory, ['show', id, '--markdown']);
}

/**
 * Creates a task via `tasks add`. With no `status`, the CLI's own default applies — the
 * project's first status — so there is nothing to hardcode here. The extension never
 * pre-validates the title: an empty one is rejected by the CLI, and that message is
 * what the caller shows.
 */
export async function addTask(
  directory: string,
  title: string,
  status?: string,
): Promise<CliResult<BoardTask>> {
  const args = ['add', title, '--json'];
  if (status !== undefined) args.push('--status', status);

  const result = await text(directory, args);
  return result.ok ? { ok: true, value: JSON.parse(result.value) as BoardTask } : result;
}

/**
 * Deletes a task via `tasks remove`. `--force` skips the CLI's own y/N prompt on
 * stdin — the caller already got a modal confirmation before this was ever spawned.
 */
export async function removeTask(directory: string, id: string): Promise<CliResult<void>> {
  const result = await text(directory, ['remove', id, '--force']);
  return result.ok ? { ok: true, value: undefined } : result;
}

/**
 * Moves a task to a status and, optionally, to a position within it. The caller reports
 * only which gap the card landed in; `rank` arithmetic stays in core, where the
 * renumbering trigger lives.
 */
export async function moveTask(
  directory: string,
  id: string,
  status: string,
  position: { before?: string; after?: string },
): Promise<CliResult<void>> {
  const args = ['move', id, status];
  if (position.before !== undefined) args.push(`--before=${position.before}`);
  if (position.after !== undefined) args.push(`--after=${position.after}`);
  const result = await text(directory, args);
  return result.ok ? { ok: true, value: undefined } : result;
}

/**
 * Saves an edited document back. The whole buffer goes to the CLI on stdin and the CLI
 * decides what it means — a rejected document comes back as a problem, and the store is
 * left exactly as it was.
 */
export async function updateTaskDocument(
  directory: string,
  id: string,
  document: string,
): Promise<CliResult<void>> {
  const result = await text(directory, ['update', id, '--markdown'], document);
  return result.ok ? { ok: true, value: undefined } : result;
}

async function text(
  directory: string,
  args: readonly string[],
  stdin?: string,
): Promise<CliResult<string>> {
  const command = resolveCliPath();

  try {
    return { ok: true, value: await spawn(command, args, directory, stdin) };
  } catch (error) {
    return { ok: false, problem: classify(error, command, directory) };
  }
}

/**
 * `promisify(execFile)` hands back a promise but not the child, and stdin needs the
 * child. Closing the stream unconditionally matters: a CLI that decides to read stdin
 * would otherwise wait for an end that never comes.
 */
function spawn(
  command: string,
  args: readonly string[],
  cwd: string,
  stdin: string | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, [...args], { cwd, maxBuffer: MAX_OUTPUT }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
    child.stdin?.end(stdin ?? '');
  });
}

function classify(error: unknown, command: string, directory: string): BoardProblem {
  const failure = error as { code?: unknown; stderr?: unknown; message?: unknown };
  return classifyCliError(
    {
      // `execFile`'s error reuses `.code` for both cases: a string like 'ENOENT' when
      // the process never started, a number (the exit status) when it ran and failed.
      code: typeof failure.code === 'string' ? failure.code : undefined,
      exitCode: typeof failure.code === 'number' ? failure.code : undefined,
      stderr: typeof failure.stderr === 'string' ? failure.stderr : undefined,
      message: typeof failure.message === 'string' ? failure.message : undefined,
    },
    command,
    directory,
  );
}
