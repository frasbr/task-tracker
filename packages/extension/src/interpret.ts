import type { BoardProblem } from './protocol.ts';

/**
 * The extension's two pieces of real reasoning, kept away from the `vscode` module so
 * they can be tested without an editor around them.
 *
 * Everything else in the extension is wiring: spawn, forward, render. These two are
 * where the edge cases live — a path that contains a colon, an error that is not the
 * error it looks like — so they get to be pure functions with tests.
 */

export interface ParsedRef {
  path: string;
  /** One-based, as written in the ref and as every terminal prints it. */
  startLine: number | undefined;
  endLine: number | undefined;
}

/**
 * Splits `src/auth.ts:42-58` into its parts.
 *
 * Line information is optional, and only a trailing `:number` or `:number-number`
 * counts as line information. A path may itself contain colons, so the split happens at
 * the end of the string rather than the first colon found.
 */
export function parseRef(ref: string): ParsedRef {
  const match = /^(.*?):(\d+)(?:-(\d+))?$/.exec(ref.trim());
  if (!match) return { path: ref.trim(), startLine: undefined, endLine: undefined };

  const startLine = Number(match[2]);
  const endLine = match[3] !== undefined ? Number(match[3]) : undefined;

  return {
    path: match[1]!,
    startLine,
    endLine: endLine !== undefined && endLine >= startLine ? endLine : undefined,
  };
}

export interface CliFailure {
  /** Set when the process could not be started at all. */
  code?: string | undefined;
  stderr?: string | undefined;
  message?: string | undefined;
}

/**
 * Turns a failed CLI run into the problem state the board renders.
 *
 * The interesting case is exit 1 mentioning `tasks init`: that is not a malfunction, it
 * is the CLI correctly reporting that this project has no store yet, and the board
 * should say so rather than showing an error.
 */
export function classifyCliError(
  failure: CliFailure,
  command: string,
  directory: string,
): BoardProblem {
  if (failure.code === 'ENOENT' || failure.code === 'EACCES') {
    return { kind: 'cli-missing', attempted: command };
  }

  const stderr = (failure.stderr ?? '').trim();
  if (stderr.includes('tasks init')) {
    return { kind: 'no-store', directory };
  }

  return {
    kind: 'cli-failed',
    message: stderr !== '' ? stderr : (failure.message ?? 'The CLI exited without explanation.'),
  };
}
