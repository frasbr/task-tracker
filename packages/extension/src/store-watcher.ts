import * as vscode from 'vscode';
import { listTasks } from './cli.ts';
import { changedIds } from './store-diff.ts';
import type { TaskDocumentProvider } from './task-document.ts';

/**
 * Watches `.tasks/tasks.jsonl` and pushes external changes to every surface, so an
 * agent's `tasks move <id> done` shows up without the human doing anything.
 *
 * The extension never parses the file it watches (AGENTS.md boundary 3): a change is a
 * signal to re-run `tasks list --json`, nothing more. Locating the store directory does
 * duplicate core's `findStoreDir` walk — that is a path convention, not task data, and
 * boundary 2 forbids importing core here regardless.
 *
 * Every write this extension makes needs to call `ignoreOwnWrite`, or its own save
 * re-renders everything out from under it a moment later. Today that is only saving a
 * task document, wired in the constructor; dragging a card will be another once it
 * exists.
 */

const DEBOUNCE_MS = 200;

/**
 * How long to ignore watcher events after a write this extension itself made. Long
 * enough to outlast the debounce delay on top of normal filesystem-event latency, short
 * enough that a genuinely concurrent external write right after ours is not missed.
 */
const SUPPRESS_MS = 500;

export class StoreWatcher implements vscode.Disposable {
  readonly #documents: TaskDocumentProvider;
  readonly #onChange: () => void;
  readonly #disposables: vscode.Disposable[] = [];

  #watcher: vscode.FileSystemWatcher | undefined;
  #debounce: ReturnType<typeof setTimeout> | undefined;
  #suppressUntil = 0;
  #lastUpdated = new Map<string, string>();

  /** `onChange` is told about every external change, debounced; it owns what to refresh. */
  constructor(documents: TaskDocumentProvider, onChange: () => void) {
    this.#documents = documents;
    this.#onChange = onChange;

    // Saving a task document is the only write this extension makes today. A future
    // write path (dragging a card, say) is not wired to anything yet, but should call
    // `ignoreOwnWrite` the same way the moment it exists — see the class doc.
    this.#disposables.push(documents.onDidWrite(() => this.ignoreOwnWrite()));
    void this.#setup();
  }

  dispose(): void {
    if (this.#debounce !== undefined) clearTimeout(this.#debounce);
    this.#watcher?.dispose();
    for (const disposable of this.#disposables.splice(0)) disposable.dispose();
  }

  /**
   * Marks a write this extension just made, so the watcher event it triggers does not
   * cause a re-render out from under whatever caused the write. Public so any write path
   * can call it directly, not only the ones already wired to it in the constructor.
   */
  ignoreOwnWrite(): void {
    this.#suppressUntil = Date.now() + SUPPRESS_MS;
  }

  async #setup(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    // No store yet is not this class's problem to solve: the board and sidebar already
    // show their own "run tasks init" state, independent of whether anything is watched.
    const storeDir = await findStoreDir(folder.uri);
    if (!storeDir) return;

    await this.#takeSnapshot(folder.uri.fsPath);

    // Both files: tasks.jsonl for task edits, config.json for column changes — a
    // `tasks status reorder` writes only the latter, and the board still needs to move.
    this.#watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(storeDir, '{tasks.jsonl,config.json}'),
    );
    const scheduled = () => this.#scheduleCheck();
    this.#disposables.push(
      this.#watcher,
      this.#watcher.onDidChange(scheduled),
      this.#watcher.onDidCreate(scheduled),
      this.#watcher.onDidDelete(scheduled),
    );
  }

  #scheduleCheck(): void {
    if (this.#debounce !== undefined) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => void this.#check(), DEBOUNCE_MS);
  }

  async #check(): Promise<void> {
    if (Date.now() < this.#suppressUntil) return;

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return;

    await this.#takeSnapshot(folder.uri.fsPath);
    this.#onChange();
  }

  /**
   * Re-reads the store and tells any open task document whose `updated` timestamp
   * actually moved to reload — not every open document on every change, which would
   * bounce a buffer someone is mid-edit on for a task that has nothing to do with
   * whatever just changed.
   */
  async #takeSnapshot(directory: string): Promise<void> {
    const result = await listTasks(directory);
    if (!result.ok) return;

    const fresh = new Map(result.value.map((task) => [task.id, task.updated]));
    for (const id of changedIds(this.#lastUpdated, fresh)) this.#documents.invalidate(id);
    this.#lastUpdated = fresh;
  }
}

async function isDirectory(uri: vscode.Uri): Promise<boolean> {
  try {
    return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.Directory;
  } catch {
    return false;
  }
}

/** Mirrors core's `findStoreDir` (locate.ts): walk up from `from` looking for `.tasks/`. */
async function findStoreDir(from: vscode.Uri): Promise<vscode.Uri | undefined> {
  let current = from;
  for (;;) {
    const candidate = vscode.Uri.joinPath(current, '.tasks');
    if (await isDirectory(candidate)) return candidate;

    const parent = vscode.Uri.joinPath(current, '..');
    if (parent.path === current.path) return undefined;
    current = parent;
  }
}
