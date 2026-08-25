import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { loadBoard, moveTask } from './cli.ts';
import { describeProblem, parseRef } from './interpret.ts';
import type { BoardStatus, FromWebview, ToWebview } from './protocol.ts';

/**
 * The board panel: webview lifecycle, and the marshalling between it and the CLI.
 *
 * Holds no task logic. It asks the CLI for JSON, forwards it, and turns a click on a
 * code reference into an editor, a drop into a `tasks move`, and a card click or "+"
 * into the same commands the sidebar uses. Anything that looks like reasoning about
 * tasks belongs in core, reached through the CLI.
 *
 * Refreshes on request, when the panel becomes visible again, after a drag persists,
 * and — via `refreshCurrent`, called by store-watcher.ts — whenever the store changes
 * on disk. The webview itself defers a store-driven refresh while a drag is in
 * progress (see webview/main.ts) rather than this class suppressing the watcher, so a
 * concurrent external write cannot yank a card out from under the cursor either.
 */

export const BOARD_VIEW_TYPE = 'taskTracker.board';

export class BoardPanel {
  static #current: BoardPanel | undefined;

  readonly #panel: vscode.WebviewPanel;
  readonly #extensionUri: vscode.Uri;
  readonly #disposables: vscode.Disposable[] = [];

  static show(extensionUri: vscode.Uri): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (BoardPanel.#current) {
      BoardPanel.#current.#panel.reveal(column);
      void BoardPanel.#current.refresh();
      return;
    }

    const panel = vscode.window.createWebviewPanel(BOARD_VIEW_TYPE, 'Tasks', column, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'out'),
        vscode.Uri.joinPath(extensionUri, 'media'),
      ],
    });

    BoardPanel.#current = new BoardPanel(panel, extensionUri);
  }

  /** Refreshes the open panel, if there is one. A no-op with nothing open to refresh. */
  static refreshCurrent(): void {
    void BoardPanel.#current?.refresh();
  }

  /** Reattaches to a panel VSCode restored from a previous session. */
  static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, 'out'),
        vscode.Uri.joinPath(extensionUri, 'media'),
      ],
    };
    BoardPanel.#current = new BoardPanel(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.#panel = panel;
    this.#extensionUri = extensionUri;

    this.#panel.webview.html = this.#html();
    this.#panel.onDidDispose(() => this.#dispose(), null, this.#disposables);

    this.#panel.webview.onDidReceiveMessage(
      (message: FromWebview) => void this.#handle(message),
      null,
      this.#disposables,
    );

    // Without a watcher, becoming visible again is the moment stale content shows.
    this.#panel.onDidChangeViewState(
      () => {
        if (this.#panel.visible) void this.refresh();
      },
      null,
      this.#disposables,
    );
  }

  async refresh(): Promise<void> {
    this.#post({ type: 'loading' });

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.#post({ type: 'problem', problem: { kind: 'no-workspace' } });
      return;
    }

    const result = await loadBoard(folder.uri.fsPath);
    this.#post(
      result.ok
        ? {
            type: 'tasks',
            tasks: result.value.tasks,
            statuses: result.value.statuses,
            project: folder.name,
          }
        : { type: 'problem', problem: result.problem },
    );
  }

  async #handle(message: FromWebview): Promise<void> {
    switch (message.type) {
      case 'ready':
      case 'refresh':
        await this.refresh();
        return;
      case 'openRef':
        await openReference(message.ref);
        return;
      case 'openTask':
        // The same command the sidebar uses to open `task:/<id>.md` — see PLAN.md
        // § Task detail: the board does not build a second editing surface.
        await vscode.commands.executeCommand('taskTracker.openTask', message.id, message.title);
        return;
      case 'move':
        await this.#move(message);
        return;
      case 'createTask':
        await vscode.commands.executeCommand('taskTracker.createTask', message.status);
        return;
      case 'deleteTask':
        await vscode.commands.executeCommand('taskTracker.deleteTask', message.id);
        return;
    }
  }

  /**
   * Persists a drop through `tasks move`, then re-renders from whatever the store says
   * — never from what the webview thinks it dropped. A move that the CLI rejects (a
   * stale neighbour id, say, because someone else just moved that same card) still
   * refreshes, which is what un-does the webview's optimistic drop animation.
   */
  async #move(message: {
    id: string;
    status: BoardStatus;
    before?: string;
    after?: string;
  }): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    const position: { before?: string; after?: string } = {};
    if (message.before !== undefined) position.before = message.before;
    if (message.after !== undefined) position.after = message.after;

    const result = await moveTask(folder.uri.fsPath, message.id, message.status, position);
    if (!result.ok) {
      void vscode.window.showWarningMessage(
        `Task Tracker: could not move that card. ${describeProblem(result.problem).detail}`,
      );
    }
    await this.refresh();
  }

  #post(message: ToWebview): void {
    void this.#panel.webview.postMessage(message);
  }

  #dispose(): void {
    BoardPanel.#current = undefined;
    this.#panel.dispose();
    for (const disposable of this.#disposables.splice(0)) disposable.dispose();
  }

  #html(): string {
    const webview = this.#panel.webview;
    const nonce = randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.#extensionUri, 'out', 'webview.js'),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.#extensionUri, 'media', 'board.css'),
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${style}" rel="stylesheet">
<title>Tasks</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" type="module" src="${script}"></script>
</body>
</html>`;
  }
}

/**
 * Opens `src/auth.ts:42-58` at the right place.
 *
 * Line information is optional and one-based, matching how the CLI stores it and how
 * every other tool in a terminal prints it.
 */
export async function openReference(ref: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const { path, startLine, endLine } = parseRef(ref);

  const uri = vscode.Uri.joinPath(folder.uri, path);

  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const options: vscode.TextDocumentShowOptions = { preview: true };
    if (startLine !== undefined) {
      // The CLI writes one-based lines; the editor API is zero-based.
      const from = startLine - 1;
      const to = (endLine ?? startLine) - 1;
      options.selection = new vscode.Range(from, 0, to, 0);
    }
    await vscode.window.showTextDocument(document, options);
  } catch {
    void vscode.window.showWarningMessage(
      `Task Tracker: could not open '${ref}'. The file may have moved since the reference was written.`,
    );
  }
}
