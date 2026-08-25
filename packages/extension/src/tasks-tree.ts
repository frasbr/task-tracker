import * as vscode from 'vscode';
import { loadBoard } from './cli.ts';
import { categoryStyle, describeProblem } from './interpret.ts';
import { columnLabel, idNumber } from './protocol.ts';
import type { BoardStatus, BoardTask } from './protocol.ts';
import { TASK_SCHEME, idOf, taskUri } from './task-document.ts';

/**
 * The sidebar list. A second view onto the same CLI output the board reads.
 *
 * Holds no task logic: it groups by the status the CLI reported and orders by the
 * `rank` the CLI wrote. It never sorts by anything it invented, and it never parses
 * the store — see AGENTS.md, "Boundaries that must not be crossed".
 *
 * A sidebar is too narrow to show every column at once, so the columns become
 * collapsible groups. The full board stays an editor tab, one click away from this
 * view's title bar.
 *
 * The columns are the project's own, in the order the CLI reports — this view holds no
 * list of its own. A column's label, icon and whether it starts open are all derived
 * from the name and its position, never a per-name table, because a status can now be
 * called anything.
 *
 * Clicking a task opens it as an editor tab (see task-document.ts). That is the reason
 * a click no longer jumps to the task's first code reference: reading the task is what
 * you want more often, and the reference is one context-menu entry away.
 */

export const TASKS_VIEW_ID = 'taskTracker.tasks';

/**
 * Icons for the four default columns, kept because they read well; any other status
 * falls back to a neutral one rather than guessing an icon from its name.
 */
const STATUS_ICONS: Record<string, string> = {
  backlog: 'circle-outline',
  priority: 'arrow-up',
  'in-progress': 'play-circle',
  done: 'pass-filled',
};

const DEFAULT_STATUS_ICON = 'circle-outline';

type Node =
  | { kind: 'column'; status: BoardStatus; tasks: BoardTask[]; expand: boolean }
  | { kind: 'task'; task: BoardTask }
  | { kind: 'problem'; heading: string; detail: string };

/**
 * The task a command invocation means.
 *
 * A command fired from a tree item's `command` gets the arguments that item supplied; the
 * same command fired from the context menu gets the tree node instead. This is the one
 * place that knows both shapes, so the command handlers stay two lines each.
 */
export function taskOf(target: unknown): BoardTask | undefined {
  const node = target as Node | undefined;
  return node?.kind === 'task' ? node.task : undefined;
}

/**
 * The status a column command was fired on, with how many tasks sit in it — the count is
 * what decides whether removing it needs somewhere for those tasks to go.
 */
export function columnOf(target: unknown): { status: BoardStatus; count: number } | undefined {
  const node = target as Node | undefined;
  return node?.kind === 'column' ? { status: node.status, count: node.tasks.length } : undefined;
}

export class TasksTreeProvider implements vscode.TreeDataProvider<Node> {
  readonly #changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly #decorations: CategoryDecorationProvider;

  constructor(decorations: CategoryDecorationProvider) {
    this.#decorations = decorations;
  }

  refresh(): void {
    this.#changed.fire();
  }

  dispose(): void {
    this.#changed.dispose();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'column':
        return columnItem(node.status, node.tasks, node.expand);
      case 'task':
        return taskItem(node.task);
      case 'problem':
        return problemItem(node.heading, node.detail);
    }
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node === undefined) return this.#roots();
    if (node.kind === 'column') return node.tasks.map((task) => ({ kind: 'task', task }));
    return [];
  }

  async #roots(): Promise<Node[]> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return [problemNode({ kind: 'no-workspace' })];

    const result = await loadBoard(folder.uri.fsPath);
    if (!result.ok) return [problemNode(result.problem)];

    const { tasks, statuses } = result.value;
    // Feed the id→category map that colours the labels, whether or not there are tasks.
    this.#decorations.update(tasks);
    if (tasks.length === 0) return [];

    // Every column, even empty ones: a list whose shape changes under you is harder to
    // navigate than one with a quiet "0" in it. Open the middle groups and close the
    // ends — for the default four that is priority and in-progress, as before, and it
    // needs no per-name configuration for any other set.
    return statuses.map((status, index) => ({
      kind: 'column',
      status,
      tasks: tasks.filter((task) => task.status === status).sort(byRank),
      expand: index !== 0 && index !== statuses.length - 1,
    }));
  }
}

/** The CLI's `rank` is the ordering; comparing it as text is what preserves it. */
function byRank(a: BoardTask, b: BoardTask): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
}

function columnItem(status: BoardStatus, tasks: BoardTask[], expand: boolean): vscode.TreeItem {
  const item = new vscode.TreeItem(
    columnLabel(status),
    tasks.length === 0
      ? vscode.TreeItemCollapsibleState.None
      : expand
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
  );
  item.description = String(tasks.length);
  // The status name rides along so the group's context-menu commands (rename, remove)
  // know which column they were fired on — see extension.ts.
  item.contextValue = 'taskTracker.column';
  item.id = `column:${status}`;
  return item;
}

function taskItem(task: BoardTask): vscode.TreeItem {
  const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.None);
  item.id = task.id;
  // Every task here shares a project prefix, so the qualified id would just be noise;
  // the number alone is what's actually distinguishing at a glance.
  item.description = idNumber(task.id);
  item.iconPath = new vscode.ThemeIcon(STATUS_ICONS[task.status] ?? DEFAULT_STATUS_ICON);
  item.tooltip = tooltip(task);

  // What lets the category decoration attach: a decoration is keyed by URI, and this is
  // the same `task:` URI the item opens. The label is set explicitly above, so giving the
  // item a resourceUri tints and badges that label rather than replacing it with a name.
  item.resourceUri = taskUri(task.id, task.title);

  // The suffix is what the "Open Reference" menu entry keys off: offering it on a task
  // with no refs would be a menu item that does nothing.
  item.contextValue = task.refs.length > 0 ? 'taskTracker.task.refs' : 'taskTracker.task';

  item.command = {
    command: 'taskTracker.openTask',
    title: 'Open Task',
    arguments: [task.id, task.title],
  };
  return item;
}

/**
 * Markdown, so notes keep their line breaks. `isTrusted` stays off: task text comes
 * from whoever ran the CLI, and a trusted tooltip can carry command links.
 */
function tooltip(task: BoardTask): vscode.MarkdownString {
  const parts = [`**${task.title}**`, '', `\`${task.id}\` · ${columnLabel(task.status)}`];

  if (task.category !== '') parts.push(`Category: ${task.category}`);
  if (task.tags.length > 0) parts.push(`Tags: ${task.tags.join(', ')}`);
  if (task.notes !== '') parts.push('', task.notes);
  if (task.refs.length > 0) parts.push('', ...task.refs.map((ref) => `- \`${ref}\``));

  return new vscode.MarkdownString(parts.join('\n'));
}

function problemNode(problem: Parameters<typeof describeProblem>[0]): Node {
  const { heading, detail, hint } = describeProblem(problem);
  return {
    kind: 'problem',
    heading,
    detail: hint === undefined ? detail : `${detail} ${hint}`,
  };
}

function problemItem(heading: string, detail: string): vscode.TreeItem {
  const item = new vscode.TreeItem(heading, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('warning');
  item.tooltip = detail;
  item.contextValue = 'taskTracker.problem';
  return item;
}

/**
 * Colours a task's sidebar label by its category. VSCode decorations are keyed by URI, so
 * this keeps the id→category map the tree hands it and answers each `task:` URI with a
 * theme colour and a two-letter badge. An uncategorised task gets nothing back — no
 * colour rather than a default one — and the colour comes from `categoryStyle`, the same
 * pure mapping the board will use, so both surfaces agree on which bucket is which.
 */
export class CategoryDecorationProvider
  implements vscode.FileDecorationProvider, vscode.Disposable
{
  readonly #changed = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.#changed.event;
  #categories = new Map<string, string>();

  /** Replaces the id→category map from the latest board and repaints every decoration. */
  update(tasks: readonly BoardTask[]): void {
    this.#categories = new Map(tasks.map((task) => [task.id, task.category]));
    this.#changed.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== TASK_SCHEME) return undefined;

    const category = this.#categories.get(idOf(uri));
    const style = category === undefined ? undefined : categoryStyle(category);
    if (style === undefined) return undefined;

    return {
      color: new vscode.ThemeColor(style.colorId),
      badge: style.badge,
      tooltip: `Category: ${category}`,
    };
  }

  dispose(): void {
    this.#changed.dispose();
  }
}
