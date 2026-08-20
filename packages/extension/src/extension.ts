import * as vscode from 'vscode';
import { BOARD_VIEW_TYPE, BoardPanel } from './board-panel.ts';

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
