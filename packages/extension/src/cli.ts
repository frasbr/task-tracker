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
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, value: JSON.parse(stdout) as BoardTask[] };
  } catch (error) {
    return { ok: false, problem: classify(error, command, directory) };
  }
}

function classify(error: unknown, command: string, directory: string): BoardProblem {
  const failure = error as { code?: unknown; stderr?: unknown; message?: unknown };
  return classifyCliError(
    {
      code: typeof failure.code === 'string' ? failure.code : undefined,
      stderr: typeof failure.stderr === 'string' ? failure.stderr : undefined,
      message: typeof failure.message === 'string' ? failure.message : undefined,
    },
    command,
    directory,
  );
}
