/**
 * The wire format between the extension host and the webview.
 *
 * `BoardTask` deliberately restates the task shape rather than importing it from
 * `@task-tracker/core`. That duplication is the visible cost of boundary #2 in
 * AGENTS.md: the extension reaches task data only through the CLI's `--json` output, so
 * what it knows about a task is a description of that JSON, not a shared type. Importing
 * core here would pull the store into the extension host and defeat the whole design.
 *
 * If the CLI's JSON changes, this changes with it.
 */

export const BOARD_COLUMNS = ['backlog', 'priority', 'in-progress', 'done'] as const;

export type BoardStatus = (typeof BOARD_COLUMNS)[number];

export interface BoardTask {
  id: string;
  title: string;
  notes: string;
  category: string;
  tags: string[];
  status: BoardStatus;
  rank: string;
  created: string;
  updated: string;
  refs: string[];
}

/** Why the board has nothing to show. Each maps to its own message in the webview. */
export type BoardProblem =
  | { kind: 'no-workspace' }
  | { kind: 'no-store'; directory: string }
  | { kind: 'cli-missing'; attempted: string }
  | { kind: 'cli-failed'; message: string };

/** Host → webview. */
export type ToWebview =
  | { type: 'loading' }
  | { type: 'tasks'; tasks: BoardTask[]; project: string }
  | { type: 'problem'; problem: BoardProblem };

/** Webview → host. Phase 3 is read-only, so this is deliberately tiny. */
export type FromWebview =
  { type: 'ready' } | { type: 'refresh' } | { type: 'openRef'; ref: string };
