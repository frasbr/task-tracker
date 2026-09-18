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

/**
 * A column name. Core fixed the set to four (ADR 0023), but this package does not import
 * that union — boundary 2 keeps it off `@task-tracker/core` — so it stays a plain string,
 * arriving at runtime with each `tasks` message from `tasks status list --json` rather
 * than known at compile time.
 */
export type BoardStatus = string;

/**
 * A column's display label, derived from its name rather than looked up in a table —
 * a status can be called anything, so `in-review` title-cases to "In Review". Names are
 * validated to hold no whitespace, so hyphens are the only word boundary.
 */
export function columnLabel(status: BoardStatus): string {
  return status
    .split('-')
    .map((word) => (word === '' ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ');
}

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
  blockedBy: string[];
}

/**
 * The number half of a `<prefix>-<n>` id. Every task in a given view shares one
 * project's prefix, so a list that showed the qualified id on every row would just be
 * repeating itself — this is what the sidebar description and card footer show instead.
 * Falls back to the full id if it does not look like `<prefix>-<n>`, which cannot happen
 * for a task the CLI produced but is a safe degrade if it ever does.
 */
export function idNumber(id: string): string {
  const match = /-(\d+)$/.exec(id);
  return match ? match[1]! : id;
}

/** Why the board has nothing to show. Each maps to its own message in the webview. */
export type BoardProblem =
  | { kind: 'no-workspace' }
  | { kind: 'no-store'; directory: string }
  | { kind: 'cli-missing'; attempted: string }
  | { kind: 'cli-outdated'; message: string }
  | { kind: 'cli-failed'; message: string };

/** Host → webview. */
export type ToWebview =
  | { type: 'loading' }
  /** `statuses` is the project's ordered column list; the board renders one column each. */
  | { type: 'tasks'; tasks: BoardTask[]; statuses: BoardStatus[]; project: string }
  | { type: 'problem'; problem: BoardProblem };

/** Webview → host. */
export type FromWebview =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'openRef'; ref: string }
  /** A card was clicked (not dragged, not its delete gesture) — open its document. */
  | { type: 'openTask'; id: string; title: string }
  /**
   * A card was dropped. `status` is the target column; `before`/`after` are the ids
   * either side of the gap it landed in, at most one of them present — see
   * `dropTarget` in webview/main.ts for how the gap is read off the rendered column.
   * Neither present means "append to an empty column". The webview never computes a
   * rank itself; the host turns this straight into `tasks move`.
   */
  | { type: 'move'; id: string; status: BoardStatus; before?: string; after?: string }
  /** The column's "+" was clicked — create a task landing in that status. */
  | { type: 'createTask'; status: BoardStatus }
  /** The card's delete gesture was used. */
  | { type: 'deleteTask'; id: string };
