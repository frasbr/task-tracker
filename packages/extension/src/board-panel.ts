import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { listTasks } from './cli.ts';
import { parseRef } from './interpret.ts';
import type { FromWebview, ToWebview } from './protocol.ts';

/**
 * The board panel: webview lifecycle, and the marshalling between it and the CLI.
 *
 * Holds no task logic. It asks the CLI for JSON, forwards it, and turns a click on a
 * code reference into an editor. Anything that looks like reasoning about tasks belongs
 * in core, reached through the CLI.
 *
 * Phase 3 is read-only, so the board refreshes when you ask it to and when it becomes
 * visible again. The file watcher that makes an agent's writes appear on their own is
 * phase 4.
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

    const result = await listTasks(folder.uri.fsPath);
    this.#post(
      result.ok
        ? { type: 'tasks', tasks: result.value, project: folder.name }
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
    }
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
async function openReference(ref: string): Promise<void> {
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
