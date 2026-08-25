import * as vscode from 'vscode';
import { BOARD_VIEW_TYPE, BoardPanel, openReference } from './board-panel.ts';
import {
  addStatus,
  addTask,
  listStatuses,
  listTasks,
  removeStatus,
  removeTask,
  renameStatus,
  showTask,
} from './cli.ts';
import { describeProblem } from './interpret.ts';
import { columnLabel } from './protocol.ts';
import type { BoardProblem, BoardTask } from './protocol.ts';
import { StoreWatcher } from './store-watcher.ts';
import { TASK_SCHEME, TaskDocumentProvider, idOf, taskUri } from './task-document.ts';
import {
  CategoryDecorationProvider,
  TASKS_VIEW_ID,
  TasksTreeProvider,
  columnOf,
  taskOf,
} from './tasks-tree.ts';

/**
 * The bridge layer. Holds no task logic of its own.
 *
 * If this file ever parses the task store, the architecture has been violated —
 * see AGENTS.md, "Boundaries that must not be crossed".
 */

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('taskTracker.openBoard', () => {
      BoardPanel.show(context.extensionUri);
    }),
  );

  context.subscriptions.push(createStatusBarItem());

  const documents = registerTaskDocuments(context);
  const tasksView = registerTasksView(context, documents);

  // Both surfaces, refreshed together — the watcher's job on an external change, and what
  // a mutation this extension made calls itself so the change shows without a round trip
  // through the filesystem watcher.
  const refreshAll = (): void => {
    BoardPanel.refreshCurrent();
    tasksView.refresh();
  };

  const watcher = new StoreWatcher(documents, refreshAll);
  context.subscriptions.push(watcher);

  registerTaskMutations(context, watcher);
  registerStatusMutations(context, watcher, refreshAll);

  // Lets VSCode restore an open board after a window reload.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(BOARD_VIEW_TYPE, {
      deserializeWebviewPanel(panel) {
        BoardPanel.revive(panel, context.extensionUri);
        return Promise.resolve();
      },
    }),
  );
}

export function deactivate(): void {
  // Disposables registered in activate() are handled by context.subscriptions, and the
  // panel cleans up its own listeners when it is disposed.
}

/**
 * The always-visible way in. The editor title button only exists while an editor is
 * open, so this covers an empty window.
 */
function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.text = '$(checklist) Tasks';
  item.tooltip = 'Open the task board';
  item.command = 'taskTracker.openBoard';
  item.show();
  return item;
}

/**
 * Tasks as editor tabs. Registering a filesystem provider is all it takes for
 * `vscode.workspace.openTextDocument` to treat a task like any other file — see
 * task-document.ts for why that beats writing one file per task.
 */
function registerTaskDocuments(context: vscode.ExtensionContext): TaskDocumentProvider {
  const documents = new TaskDocumentProvider();

  context.subscriptions.push(
    documents,
    vscode.workspace.registerFileSystemProvider(TASK_SCHEME, documents, {
      isCaseSensitive: true,
    }),
    vscode.commands.registerCommand(
      'taskTracker.openTask',
      (target: unknown, maybeTitle?: unknown) => {
        if (typeof target === 'string') {
          void openTask(target, typeof maybeTitle === 'string' ? maybeTitle : '');
          return;
        }
        const task = taskOf(target);
        if (task !== undefined) void openTask(task.id, task.title);
      },
    ),
  );

  return documents;
}

/**
 * Opens a task, or says why it could not — an id can be stale by the time it is
 * clicked. Reuses an already-open tab for this id rather than opening a second one
 * under a fresh slug: a renamed task's old tab is still open under its old name, and
 * that is the one that should come to the front.
 */
async function openTask(id: string, title: string): Promise<void> {
  if (id === '') return;

  try {
    const existing = vscode.workspace.textDocuments.find(
      (document) => document.uri.scheme === TASK_SCHEME && idOf(document.uri) === id,
    );
    const document = existing ?? (await vscode.workspace.openTextDocument(taskUri(id, title)));
    await vscode.window.showTextDocument(document, { preview: true });
  } catch (error) {
    void vscode.window.showErrorMessage(
      error instanceof Error ? error.message : `Could not open task ${id}.`,
    );
  }
}

/**
 * The sidebar view, plus the two commands that only exist to serve it.
 *
 * Refreshes on the title-bar button, whenever the view is revealed, after a task
 * document is saved, and — via the returned provider, wired into a `StoreWatcher` by
 * the caller — whenever the store changes on disk.
 */
function registerTasksView(
  context: vscode.ExtensionContext,
  documents: TaskDocumentProvider,
): TasksTreeProvider {
  // Colours the task labels by category. The tree feeds it the id→category map on every
  // refresh; VSCode asks it for each task URI's decoration.
  const decorations = new CategoryDecorationProvider();
  const provider = new TasksTreeProvider(decorations);
  const view = vscode.window.createTreeView(TASKS_VIEW_ID, { treeDataProvider: provider });

  context.subscriptions.push(
    decorations,
    vscode.window.registerFileDecorationProvider(decorations),
  );

  documents.onDidWrite(() => provider.refresh(), null, context.subscriptions);

  view.onDidChangeVisibility(
    (event) => {
      if (event.visible) provider.refresh();
    },
    null,
    context.subscriptions,
  );

  context.subscriptions.push(
    provider,
    view,
    vscode.commands.registerCommand('taskTracker.refreshTasks', () => provider.refresh()),
    vscode.commands.registerCommand('taskTracker.openRef', (target: unknown) => {
      // The board sends a ref; the tree's context menu sends the node it was fired on.
      const ref = typeof target === 'string' ? target : taskOf(target)?.refs[0];
      if (ref !== undefined) void openReference(ref);
    }),
  );

  return provider;
}

/**
 * The two write commands: create and delete. Both live here, not in the tree view or
 * the board, because both surfaces call them — the sidebar's "+" and context menu today,
 * the board via `executeCommand` once its own gestures land. All prompting and
 * CLI-spawning for a mutation happens in exactly one of these two handlers.
 */
function registerTaskMutations(context: vscode.ExtensionContext, watcher: StoreWatcher): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('taskTracker.createTask', (status: unknown) => {
      void createTask(typeof status === 'string' ? status : undefined, watcher);
    }),
    vscode.commands.registerCommand('taskTracker.deleteTask', (target: unknown) => {
      void deleteTask(target, watcher);
    }),
  );
}

/**
 * The status commands, plus the sidebar `+` that fronts them. A column can now be
 * created, renamed and removed without leaving the sidebar. Validation stays in the CLI
 * (AGENTS.md boundary 3): the extension gathers input, spawns, and surfaces whatever the
 * CLI says — it never pre-checks a name or decides where tasks may go.
 */
function registerStatusMutations(
  context: vscode.ExtensionContext,
  watcher: StoreWatcher,
  refreshAll: () => void,
): void {
  context.subscriptions.push(
    // The sidebar title `+`: one gesture, two kinds of "new".
    vscode.commands.registerCommand('taskTracker.newItem', () => void newItem(watcher, refreshAll)),
    vscode.commands.registerCommand(
      'taskTracker.renameStatus',
      (target: unknown) => void renameColumn(target, refreshAll),
    ),
    vscode.commands.registerCommand(
      'taskTracker.removeStatus',
      (target: unknown) => void removeColumn(target, refreshAll),
    ),
  );
}

/** The `+` menu: a new task (the common case, so it is first) or a new column. */
async function newItem(watcher: StoreWatcher, refreshAll: () => void): Promise<void> {
  const choice = await vscode.window.showQuickPick(
    [
      { label: '$(add) New task…', action: 'task' as const },
      { label: '$(list-unordered) New status…', action: 'status' as const },
    ],
    { placeHolder: 'Create a task or a column' },
  );
  if (choice === undefined) return;

  if (choice.action === 'task') {
    await createTask(undefined, watcher);
    return;
  }
  await createStatus(refreshAll);
}

/**
 * Prompts for a name, then for where the column goes — a position the user chooses rather
 * than a silent append, because on a board they are looking at the order. "At the end" is
 * the default, and every gap between existing columns is offered as "Before <column>".
 */
async function createStatus(refreshAll: () => void): Promise<void> {
  const directory = requireWorkspaceDirectory();
  if (directory === undefined) return;

  const name = await vscode.window.showInputBox({
    prompt: 'New column name',
    placeHolder: 'review',
  });
  if (name === undefined) return; // cancelled

  const statuses = await listStatuses(directory);
  if (!statuses.ok) {
    void vscode.window.showErrorMessage(problemMessage(statuses.problem));
    return;
  }

  const position = await pickPosition(statuses.value);
  if (position === undefined) return; // cancelled

  const result = await addStatus(directory, name, position);
  if (!result.ok) {
    void vscode.window.showErrorMessage(problemMessage(result.problem));
    return;
  }
  refreshAll();
}

/** Renames the column a context-menu command was fired on. */
async function renameColumn(target: unknown, refreshAll: () => void): Promise<void> {
  const directory = requireWorkspaceDirectory();
  if (directory === undefined) return;

  const column = columnOf(target);
  if (column === undefined) return;

  const to = await vscode.window.showInputBox({
    prompt: `Rename column "${columnLabel(column.status)}"`,
    value: column.status,
  });
  if (to === undefined || to === column.status) return;

  const result = await renameStatus(directory, column.status, to);
  if (!result.ok) {
    void vscode.window.showErrorMessage(problemMessage(result.problem));
    return;
  }
  refreshAll();
}

/**
 * Removes the column a context-menu command was fired on. A non-empty column needs
 * somewhere for its tasks to go, asked for with the same kind of prompt as placing a new
 * one — the CLI refuses otherwise, and this makes the destination a deliberate choice.
 */
async function removeColumn(target: unknown, refreshAll: () => void): Promise<void> {
  const directory = requireWorkspaceDirectory();
  if (directory === undefined) return;

  const column = columnOf(target);
  if (column === undefined) return;

  const statuses = await listStatuses(directory);
  if (!statuses.ok) {
    void vscode.window.showErrorMessage(problemMessage(statuses.problem));
    return;
  }
  const others = statuses.value.filter((status) => status !== column.status);

  let moveTo: string | undefined;
  if (column.count > 0) {
    if (others.length === 0) {
      void vscode.window.showErrorMessage(
        `"${columnLabel(column.status)}" is the only column and still holds tasks, so it cannot be removed.`,
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      others.map((status) => ({ label: columnLabel(status), status })),
      {
        placeHolder: `Move ${column.count} task${column.count === 1 ? '' : 's'} to which column?`,
      },
    );
    if (picked === undefined) return; // cancelled
    moveTo = picked.status;
  }

  const result = await removeStatus(directory, column.status, moveTo);
  if (!result.ok) {
    void vscode.window.showErrorMessage(problemMessage(result.problem));
    return;
  }
  refreshAll();
}

/**
 * Where a new column goes. "At the end" is offered first, so it is the default; every
 * other choice is "Before <column>", which together with "at the end" can express any
 * gap. An empty object means append. `undefined` means the user cancelled.
 */
async function pickPosition(
  statuses: readonly string[],
): Promise<{ after?: string; before?: string } | undefined> {
  const items = [
    { label: 'At the end', position: {} as { after?: string; before?: string } },
    ...statuses.map((status) => ({
      label: `Before ${columnLabel(status)}`,
      position: { before: status },
    })),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Where should the new column go?',
  });
  return picked?.position;
}

/**
 * Prompts for a title, creates the task, then opens its document so the rest of the
 * fields get filled in the editor rather than a form. `status` comes from whoever
 * invoked the command — the sidebar's "+" passes none, which is how a task lands in the
 * project's first status without this file knowing what that status is called.
 *
 * The title is not pre-validated (see AGENTS.md boundary 3): an empty one is sent to
 * the CLI exactly as typed, and its rejection is what the user sees.
 */
async function createTask(status: string | undefined, watcher: StoreWatcher): Promise<void> {
  const directory = requireWorkspaceDirectory();
  if (directory === undefined) return;

  const title = await vscode.window.showInputBox({
    prompt: 'New task title',
    placeHolder: 'Fix the thing',
  });
  if (title === undefined) return; // cancelled

  const result = await addTask(directory, title, status);
  if (!result.ok) {
    void vscode.window.showErrorMessage(problemMessage(result.problem));
    return;
  }

  watcher.ignoreOwnWrite();
  await openTask(result.value.id, result.value.title);
}

/**
 * Confirms with a modal naming the task, then deletes it. `target` carries whatever the
 * command was fired with: a bare id from the board, a tree node from the sidebar's
 * context menu, or nothing from the command palette — each resolved to the same
 * `{ id, title }` shape before the modal ever appears, so the prompt always names what
 * it is about to lose — ids are short now, so a mistyped one can land on a real task.
 */
async function deleteTask(target: unknown, watcher: StoreWatcher): Promise<void> {
  const directory = requireWorkspaceDirectory();
  if (directory === undefined) return;

  const picked = await resolveTaskToDelete(target, directory);
  if (picked === undefined) return;

  const confirmed = await vscode.window.showWarningMessage(
    `Delete "${picked.title}" (${picked.id})? This cannot be undone.`,
    { modal: true },
    'Delete',
  );
  if (confirmed !== 'Delete') return;

  const result = await removeTask(directory, picked.id);
  if (!result.ok) {
    void vscode.window.showErrorMessage(problemMessage(result.problem));
    return;
  }

  watcher.ignoreOwnWrite();
}

/** What `deleteTask` was invoked on, reduced to the id and title the modal needs. */
async function resolveTaskToDelete(
  target: unknown,
  directory: string,
): Promise<{ id: string; title: string } | undefined> {
  if (typeof target === 'string') {
    const result = await showTask(directory, target);
    if (!result.ok) {
      void vscode.window.showErrorMessage(problemMessage(result.problem));
      return undefined;
    }
    return { id: result.value.id, title: result.value.title };
  }

  const fromTree = taskOf(target);
  if (fromTree !== undefined) return { id: fromTree.id, title: fromTree.title };

  // No argument: fired from the command palette. Ask which task.
  return pickTaskToDelete(directory);
}

async function pickTaskToDelete(
  directory: string,
): Promise<{ id: string; title: string } | undefined> {
  const result = await listTasks(directory);
  if (!result.ok) {
    void vscode.window.showErrorMessage(problemMessage(result.problem));
    return undefined;
  }
  if (result.value.length === 0) {
    void vscode.window.showInformationMessage('No tasks to delete.');
    return undefined;
  }

  const picked = await vscode.window.showQuickPick(
    result.value.map((task) => quickPickItem(task)),
    { placeHolder: 'Which task should be deleted?' },
  );
  return picked?.task;
}

function quickPickItem(task: BoardTask): vscode.QuickPickItem & { task: BoardTask } {
  return { label: task.title, description: task.id, task };
}

function requireWorkspaceDirectory(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    void vscode.window.showErrorMessage('Tasks live inside a project. Open a folder first.');
    return undefined;
  }
  return folder.uri.fsPath;
}

/** Same wording the board and the sidebar tree use for a problem — see interpret.ts. */
function problemMessage(problem: BoardProblem): string {
  const { heading, detail, hint } = describeProblem(problem);
  return hint === undefined ? `${heading}. ${detail}` : `${heading}. ${detail} ${hint}`;
}
