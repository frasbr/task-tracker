import * as vscode from 'vscode';
import { showTask, showTaskDocument, updateTaskDocument } from './cli.ts';
import { describeProblem } from './interpret.ts';
import type { BoardProblem } from './protocol.ts';
import { documentName, idFromDocumentName } from './task-naming.ts';

/**
 * Tasks as editor tabs.
 *
 * A `task:` URI looks like a file to VSCode — it opens in a normal editor, gets markdown
 * highlighting from its `.md` name, saves with the usual keystroke — but nothing is on
 * disk. Reads run `tasks show --markdown`, writes run `tasks update --markdown`, and the
 * store stays a single JSONL file that only the CLI opens.
 *
 * That is the whole point of doing it this way: you get the "one file per task" feeling
 * without one file per task, so no migration, no second source of truth, and no route
 * around the CLI's validation. See PLAN.md § Task documents.
 *
 * The URI is `task:/<prefix>-<n>-<slug>.md` — the qualified id at the front, a slug made
 * from the title for a readable tab name. The id is the identity; the slug is cosmetic
 * and may go stale the moment the title changes. That split is deliberate: a URI that
 * changed on every rename would strand the tab you were typing in, so only `idOf` below
 * is ever used to tell two documents apart, never the full path.
 */

export const TASK_SCHEME = 'task';

/** How long a load is reused. Long enough to collapse VSCode's stat-then-read on open. */
const CACHE_MS = 750;

export function taskUri(id: string, title: string): vscode.Uri {
  return vscode.Uri.from({ scheme: TASK_SCHEME, path: `/${documentName(id, title)}` });
}

export function idOf(uri: vscode.Uri): string {
  return idFromDocumentName(uri.path.replace(/^\/+/, ''));
}

interface Loaded {
  text: string;
  created: number;
  updated: number;
  at: number;
}

export class TaskDocumentProvider implements vscode.FileSystemProvider, vscode.Disposable {
  readonly #changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly #written = new vscode.EventEmitter<string>();
  readonly #cache = new Map<string, Loaded>();

  readonly onDidChangeFile = this.#changed.event;

  /** Fires with the task id after a successful save, so other views can catch up. */
  readonly onDidWrite = this.#written.event;

  dispose(): void {
    this.#changed.dispose();
    this.#written.dispose();
  }

  /**
   * Tells any open editor of this task to re-read it. The store's own file watcher is
   * phase 4; when it lands, this is the method it calls.
   *
   * Fires for whatever URI is actually open, found by id rather than reconstructed —
   * the slug in a stale tab's URI may no longer match the task's current title, and
   * firing a change for a URI nothing has open would do nothing anyway.
   */
  invalidate(id: string): void {
    this.#cache.delete(id);
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme === TASK_SCHEME && idOf(document.uri) === id) {
        this.#changed.fire([{ type: vscode.FileChangeType.Changed, uri: document.uri }]);
      }
    }
  }

  // ---------------------------------------------------------------- reading

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const loaded = await this.#load(idOf(uri));
    return {
      type: vscode.FileType.File,
      ctime: loaded.created,
      mtime: loaded.updated,
      size: Buffer.byteLength(loaded.text, 'utf8'),
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const loaded = await this.#load(idOf(uri));
    return Buffer.from(loaded.text, 'utf8');
  }

  // ---------------------------------------------------------------- writing

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const id = idOf(uri);
    const directory = requireWorkspace();

    const result = await updateTaskDocument(directory, id, Buffer.from(content).toString('utf8'));
    if (!result.ok) {
      // Refusing the write leaves the buffer dirty with the text still in it, which is
      // what you want when the CLI rejected a typo'd status.
      throw vscode.FileSystemError.NoPermissions(problemLine(result.problem));
    }

    // The store normalises — tags sort, refs dedupe, the title trims — so the saved
    // buffer is re-read rather than assumed. Disk is the only truth, here as everywhere.
    this.#cache.delete(id);
    this.#changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    this.#written.fire(id);
  }

  // ---------------------------------------------------------------- not a real filesystem

  watch(): vscode.Disposable {
    // Changes are pushed from `invalidate` and from saves; there is nothing to poll.
    return new vscode.Disposable(() => undefined);
  }

  readDirectory(): [string, vscode.FileType][] {
    // The board and the sidebar are how you browse tasks; this scheme addresses one.
    throw vscode.FileSystemError.NoPermissions('Tasks are not a browsable folder.');
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Tasks are not a browsable folder.');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions(
      'Deleting a task from its editor is too easy to do by accident. Use `tasks remove <id>`.',
    );
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions(
      'A task is named by its title. Edit the `title:` line instead.',
    );
  }

  // ---------------------------------------------------------------- internals

  async #load(id: string): Promise<Loaded> {
    const cached = this.#cache.get(id);
    if (cached !== undefined && Date.now() - cached.at < CACHE_MS) return cached;

    const directory = requireWorkspace();
    const [task, text] = await Promise.all([
      showTask(directory, id),
      showTaskDocument(directory, id),
    ]);

    if (!task.ok) throw readFailure(id, task.problem);
    if (!text.ok) throw readFailure(id, text.problem);

    const loaded: Loaded = {
      text: text.value,
      created: Date.parse(task.value.created),
      updated: Date.parse(task.value.updated),
      at: Date.now(),
    };
    this.#cache.set(id, loaded);
    return loaded;
  }
}

function requireWorkspace(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    throw vscode.FileSystemError.Unavailable('Tasks live inside a project. Open a folder first.');
  }
  return folder.uri.fsPath;
}

/**
 * VSCode replaces a `FileNotFound` error's message with its own generic text and
 * closes the tab — the right outcome for a task that genuinely does not exist. Anything
 * else (the CLI is missing, it is too old to understand the request, it crashed) is not
 * the task's fault, so it becomes `Unavailable`, whose message VSCode shows verbatim and
 * whose tab it leaves open.
 */
function readFailure(id: string, problem: BoardProblem): vscode.FileSystemError {
  if (problem.kind === 'cli-missing' || problem.kind === 'cli-outdated') {
    return vscode.FileSystemError.Unavailable(problemLine(problem));
  }
  return vscode.FileSystemError.FileNotFound(`${id}: ${problemLine(problem)}`);
}

function problemLine(problem: BoardProblem): string {
  const { heading, detail, hint } = describeProblem(problem);
  return (problem.kind === 'cli-failed' || problem.kind === 'cli-outdated') && hint !== undefined
    ? hint
    : `${heading}. ${detail}`;
}
