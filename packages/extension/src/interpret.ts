import type { BoardProblem } from './protocol.ts';

/**
 * The extension's two pieces of real reasoning, kept away from the `vscode` module so
 * they can be tested without an editor around them.
 *
 * Everything else in the extension is wiring: spawn, forward, render. These two are
 * where the edge cases live — a path that contains a colon, an error that is not the
 * error it looks like — so they get to be pure functions with tests.
 */

/**
 * The palette a category is coloured from: theme-colour ids, not hex, so the colours
 * track the user's theme and read in both light and dark. The `charts.*` family is six
 * entries present in every VSCode theme — chosen for exactly that reason.
 *
 * The board (a later task) colours from the same function, so the two surfaces agree on
 * which bucket is which colour without sharing anything but this module.
 */
const CATEGORY_COLORS = [
  'charts.red',
  'charts.orange',
  'charts.yellow',
  'charts.green',
  'charts.blue',
  'charts.purple',
] as const;

export interface CategoryStyle {
  /** A `vscode.ThemeColor` id from `CATEGORY_COLORS`. */
  colorId: string;
  /** At most two characters — VSCode caps a file-decoration badge there. */
  badge: string;
}

/**
 * Maps a category to a stable colour and badge, or `undefined` when there is no category
 * — an uncategorised task gets no decoration rather than a seventh colour.
 *
 * The colour is chosen by hashing the name into the fixed palette: the same category is
 * the same colour in every project and every session, with nothing to configure. The
 * hash is a plain djb2 over char codes, deliberately dull — it is the kind of function
 * that silently changes meaning when someone "simplifies" it, so it is pinned by tests.
 */
export function categoryStyle(category: string): CategoryStyle | undefined {
  const name = category.trim();
  if (name === '') return undefined;

  let hash = 5381;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 33 + name.charCodeAt(i)) >>> 0;
  }

  return {
    colorId: CATEGORY_COLORS[hash % CATEGORY_COLORS.length]!,
    badge: name.slice(0, 2),
  };
}

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
  /** The process's exit code, when it ran and exited non-zero. */
  exitCode?: number | undefined;
  stderr?: string | undefined;
  message?: string | undefined;
}

/**
 * Turns a failed CLI run into the problem state the board renders.
 *
 * Two exit codes carry meaning beyond "something went wrong" (see AGENTS.md): exit 1
 * mentioning `tasks init` is the CLI correctly reporting that this project has no store
 * yet, and exit 2 is the CLI refusing a request it could not parse. The extension only
 * ever sends requests it built itself, so a 2 means its interface and the installed
 * CLI's have drifted apart — a version-skew bug, not a store problem.
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

  if (failure.exitCode === 2) {
    return {
      kind: 'cli-outdated',
      message:
        stderr !== '' ? stderr : (failure.message ?? 'The installed CLI rejected this request.'),
    };
  }

  if (stderr.includes('tasks init')) {
    return { kind: 'no-store', directory };
  }

  return {
    kind: 'cli-failed',
    message: stderr !== '' ? stderr : (failure.message ?? 'The CLI exited without explanation.'),
  };
}

/**
 * Turns a problem into the words a person reads. Shared by the board and the sidebar
 * tree so the two never disagree about what went wrong.
 */
export function describeProblem(problem: BoardProblem): {
  heading: string;
  detail: string;
  hint?: string;
} {
  switch (problem.kind) {
    case 'no-workspace':
      return {
        heading: 'No folder open',
        detail: 'Tasks live inside a project. Open a folder and the board will find its store.',
      };
    case 'no-store':
      return {
        heading: 'No task store here yet',
        detail: `Nothing was found at or above ${problem.directory}. Create one from a terminal:`,
        hint: 'tasks init',
      };
    case 'cli-missing':
      return {
        heading: 'Cannot find the tasks CLI',
        detail: `Tried to run '${problem.attempted}'. Put it on your PATH, or set taskTracker.cliPath to its full path.`,
        hint: 'npm link -w @task-tracker/cli',
      };
    case 'cli-outdated':
      return {
        heading: 'The installed tasks CLI is out of date',
        detail: 'This request needs a newer CLI interface than the one on your PATH.',
        hint: `${problem.message} — reinstall it: npm run install-cli`,
      };
    case 'cli-failed':
      return {
        heading: 'The tasks CLI reported a problem',
        detail: 'The board could not read the store.',
        hint: problem.message,
      };
  }
}
