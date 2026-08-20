import { BOARD_COLUMNS } from '../protocol.ts';
import type { BoardProblem, BoardStatus, BoardTask, FromWebview, ToWebview } from '../protocol.ts';

/**
 * The board UI. Runs in the webview's browser context — no Node APIs, no filesystem.
 *
 * Everything is built with `document.createElement` and `textContent` rather than
 * assembled HTML. Task titles and notes are arbitrary text written by whoever used the
 * CLI, and a webview shares an origin with the rest of the extension, so string
 * concatenation into innerHTML is the one thing that must never happen here.
 *
 * Phase 3 renders. Editing, drag and the live watcher are phase 4.
 */

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

const COLUMN_LABELS: Record<BoardStatus, string> = {
  backlog: 'Backlog',
  priority: 'Priority',
  'in-progress': 'In progress',
  done: 'Done',
};

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'loading':
      renderLoading();
      return;
    case 'tasks':
      renderBoard(message.tasks, message.project);
      return;
    case 'problem':
      renderProblem(message.problem);
      return;
  }
});

vscode.postMessage({ type: 'ready' });

// ---------------------------------------------------------------- rendering

function renderLoading(): void {
  // Only show a spinner on a cold start; refreshing an existing board should not flash.
  if (root.querySelector('.board')) return;
  replace(
    root,
    element('div', 'placeholder', [element('p', 'placeholder-text', 'Loading tasks…')]),
  );
}

function renderBoard(tasks: BoardTask[], project: string): void {
  const columns = element('div', 'board');
  for (const status of BOARD_COLUMNS) {
    columns.append(
      renderColumn(
        status,
        tasks.filter((task) => task.status === status),
      ),
    );
  }
  replace(root, header(project, tasks.length), columns);
}

function header(project: string, total: number): HTMLElement {
  const refresh = element('button', 'refresh', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

  return element('header', 'header', [
    element('h1', 'project', project),
    element('span', 'total', `${total} ${total === 1 ? 'task' : 'tasks'}`),
    refresh,
  ]);
}

function renderColumn(status: BoardStatus, tasks: BoardTask[]): HTMLElement {
  const column = element('section', `column column-${status}`);

  column.append(
    element('div', 'column-header', [
      element('h2', 'column-title', COLUMN_LABELS[status]),
      element('span', 'column-count', String(tasks.length)),
    ]),
  );

  const cards = element('div', 'cards');
  if (tasks.length === 0) {
    cards.append(element('p', 'column-empty', 'Nothing here'));
  } else {
    for (const task of tasks) cards.append(renderCard(task));
  }

  column.append(cards);
  return column;
}

function renderCard(task: BoardTask): HTMLElement {
  const card = element('article', 'card');
  card.append(element('p', 'card-title', task.title));

  const meta = element('div', 'card-meta');
  if (task.category !== '') meta.append(element('span', 'category', task.category));
  for (const tag of task.tags) meta.append(element('span', 'tag', `#${tag}`));
  if (meta.childElementCount > 0) card.append(meta);

  if (task.refs.length > 0) card.append(renderRefs(task.refs));

  const footer = element('div', 'card-footer', [element('span', 'card-id', task.id)]);
  if (task.notes.trim() !== '') footer.append(element('span', 'card-has-notes', 'notes'));
  card.append(footer);

  return card;
}

function renderRefs(refs: string[]): HTMLElement {
  const list = element('div', 'refs');
  for (const ref of refs) {
    const button = element('button', 'ref', ref);
    button.type = 'button';
    button.title = `Open ${ref}`;
    button.addEventListener('click', () => vscode.postMessage({ type: 'openRef', ref }));
    list.append(button);
  }
  return list;
}

function renderProblem(problem: BoardProblem): void {
  const { heading, detail, hint } = describeProblem(problem);

  const parts: HTMLElement[] = [
    element('h2', 'placeholder-heading', heading),
    element('p', 'placeholder-text', detail),
  ];
  if (hint !== undefined) parts.push(element('pre', 'placeholder-hint', hint));

  const retry = element('button', 'refresh', 'Try again');
  retry.type = 'button';
  retry.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  parts.push(retry);

  replace(root, element('div', 'placeholder', parts));
}

function describeProblem(problem: BoardProblem): {
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
    case 'cli-failed':
      return {
        heading: 'The tasks CLI reported a problem',
        detail: 'The board could not read the store.',
        hint: problem.message,
      };
  }
}

// ---------------------------------------------------------------- DOM helpers

type Content = string | HTMLElement[] | undefined;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content?: Content,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (typeof content === 'string') node.textContent = content;
  else if (Array.isArray(content)) node.append(...content);
  return node;
}

function replace(target: HTMLElement, ...children: HTMLElement[]): void {
  target.replaceChildren(...children);
}
