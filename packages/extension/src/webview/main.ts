import { describeProblem } from '../interpret.ts';
import { columnLabel, idNumber } from '../protocol.ts';
import type { BoardProblem, BoardStatus, BoardTask, FromWebview, ToWebview } from '../protocol.ts';
import { doneIds, filterTasks, isBlocked, sortColumn } from './board-view.ts';
import type { SortKey } from './board-view.ts';
import { dropPosition } from './drop-position.ts';

/**
 * The board UI. Runs in the webview's browser context — no Node APIs, no filesystem.
 *
 * Everything is built with `document.createElement` and `textContent` rather than
 * assembled HTML. Task titles and notes are arbitrary text written by whoever used the
 * CLI, and a webview shares an origin with the rest of the extension, so string
 * concatenation into innerHTML is the one thing that must never happen here.
 *
 * What stays on the card (tt-6): a click opens the task's document — the same
 * `task:/<id>.md` the sidebar opens — and drag is itself the quick status/reorder
 * gesture, plus a delete affordance. A second field-by-field editing surface was
 * considered and rejected.
 *
 * Drag (tt-4) never computes a rank. A drop reports the target column and the ids
 * either side of the gap; the host turns that into `tasks move` and the next `tasks`
 * message this listener receives is what actually moves the card on screen — this
 * file only ever renders what it was told, never what it thinks just happened.
 */

declare function acquireVsCodeApi(): {
  postMessage(message: FromWebview): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById('root')!;

/**
 * Filter and sort live here, in the webview, not in the store — they are a view concern
 * and there is no field for them. The host re-sends the whole list on every render, so we
 * filter and sort a copy each time and the view survives an agent writing underneath it.
 * The pure logic is in `board-view.ts`; this file holds the state and wiring.
 * `getState`/`setState` carry the choices across a webview reload too.
 */
interface ViewState {
  category: string;
  tag: string;
  sort: SortKey;
}

const saved = vscode.getState() as Partial<ViewState> | undefined;
let filterCategory = saved?.category ?? '';
let filterTag = saved?.tag ?? '';
let sortKey: SortKey = saved?.sort ?? 'rank';

/** The last board the host sent, so a control change can re-render without a round trip. */
let latest: { tasks: BoardTask[]; statuses: BoardStatus[]; project: string } | undefined;

function saveViewState(): void {
  vscode.setState({ category: filterCategory, tag: filterTag, sort: sortKey } satisfies ViewState);
}

function rerender(): void {
  if (latest) renderBoard(latest.tasks, latest.statuses, latest.project);
}

/**
 * A store-driven render that arrived while a drag is in progress. Applied the moment
 * the drag ends instead of immediately — replacing the board mid-drag would tear the
 * dragged card out of the DOM and abort the browser's own drag gesture, whether the
 * update was caused by this drag's own write landing early or by something unrelated
 * (an agent's `tasks move` from a terminal) firing at the same time. See the module
 * doc and AGENTS.md's "watcher thrash".
 */
let pendingRender: { tasks: BoardTask[]; statuses: BoardStatus[]; project: string } | undefined;

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const message = event.data;
  switch (message.type) {
    case 'loading':
      renderLoading();
      return;
    case 'tasks':
      if (dragState) {
        pendingRender = {
          tasks: message.tasks,
          statuses: message.statuses,
          project: message.project,
        };
      } else {
        renderBoard(message.tasks, message.statuses, message.project);
      }
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

function renderBoard(tasks: BoardTask[], statuses: BoardStatus[], project: string): void {
  latest = { tasks, statuses, project };

  const done = doneIds(tasks);

  const shown = filterTasks(tasks, { category: filterCategory, tag: filterTag });
  const columns = element('div', 'board');
  for (const status of statuses) {
    columns.append(
      renderColumn(
        status,
        sortColumn(
          shown.filter((task) => task.status === status),
          sortKey,
        ),
        done,
      ),
    );
  }
  replace(root, header(project, tasks.length, shown.length), controls(tasks), columns);
}

function header(project: string, total: number, shown: number): HTMLElement {
  const refresh = element('button', 'refresh', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

  const count =
    shown === total ? `${total} ${total === 1 ? 'task' : 'tasks'}` : `${shown} of ${total} tasks`;

  return element('header', 'header', [
    element('h1', 'project', project),
    element('span', 'total', count),
    refresh,
  ]);
}

// ---------------------------------------------------------------- filter and sort

/**
 * The filter/sort bar. Category and tag options come from the whole task list, not the
 * filtered view, so narrowing to one category does not empty the other menus. An active
 * value that no longer exists in the tasks is kept as an option so the state stays honest
 * rather than silently resetting.
 */
function controls(tasks: BoardTask[]): HTMLElement {
  const categories = distinct(tasks.map((task) => task.category).filter((c) => c !== ''));
  const tags = distinct(tasks.flatMap((task) => task.tags));

  const category = select(
    'Category',
    optionsWith(filterCategory, 'All categories', categories),
    filterCategory,
    (value) => {
      filterCategory = value;
      saveViewState();
      rerender();
    },
  );

  const tag = select('Tag', optionsWith(filterTag, 'All tags', tags), filterTag, (value) => {
    filterTag = value;
    saveViewState();
    rerender();
  });

  const sort = select(
    'Sort',
    [
      { value: 'rank', label: 'Manual order' },
      { value: 'updated', label: 'Recently updated' },
      { value: 'created', label: 'Oldest first' },
    ],
    sortKey,
    (value) => {
      sortKey = value as SortKey;
      saveViewState();
      rerender();
    },
  );

  return element('div', 'controls', [category, tag, sort]);
}

/** `All …` first, then one option per value, with the current value kept even if it is gone. */
function optionsWith(
  current: string,
  allLabel: string,
  values: string[],
): { value: string; label: string }[] {
  const present = new Set(values);
  const extra = current !== '' && !present.has(current) ? [current] : [];
  return [
    { value: '', label: allLabel },
    ...[...values, ...extra].map((value) => ({ value, label: value })),
  ];
}

function select(
  label: string,
  options: { value: string; label: string }[],
  current: string,
  onChange: (value: string) => void,
): HTMLElement {
  const el = document.createElement('select');
  el.className = 'control-select';
  el.setAttribute('aria-label', label);
  el.title = label;
  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.value;
    node.textContent = option.label;
    if (option.value === current) node.selected = true;
    el.append(node);
  }
  el.addEventListener('change', () => onChange(el.value));
  return el;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function renderColumn(
  status: BoardStatus,
  tasks: BoardTask[],
  done: ReadonlySet<string>,
): HTMLElement {
  const column = element('section', `column column-${status}`);

  const label = columnLabel(status);
  const add = element('button', 'column-add', '+');
  add.type = 'button';
  add.title = `New task in ${label}`;
  add.setAttribute('aria-label', `New task in ${label}`);
  add.addEventListener('click', () => vscode.postMessage({ type: 'createTask', status }));

  column.append(
    element('div', 'column-header', [
      element('h2', 'column-title', label),
      element('span', 'column-count', String(tasks.length)),
      add,
    ]),
  );

  const cards = element('div', 'cards');
  cards.addEventListener('dragover', (event) => handleDragOver(event, cards));
  cards.addEventListener('drop', (event) => handleDrop(event, cards, status));

  if (tasks.length === 0) {
    cards.append(element('p', 'column-empty', 'Nothing here'));
  } else {
    for (const task of tasks) cards.append(renderCard(task, done));
  }

  column.append(cards);
  return column;
}

function renderCard(task: BoardTask, done: ReadonlySet<string>): HTMLElement {
  const card = element('article', 'card');
  card.dataset.id = task.id;
  // Drag reorders within the manual `rank` order; under any other sort a drop position
  // would be meaningless, so dragging is turned off until the sort is back to Manual.
  card.draggable = sortKey === 'rank';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.title = `Open ${task.title}`;

  // Only this card renders differently — the upstream prerequisite card is unchanged.
  const blocked = isBlocked(task, done);
  if (blocked) card.classList.add('blocked');

  card.addEventListener('dragstart', (event) => {
    dragState = { id: task.id };
    card.classList.add('dragging');
    event.dataTransfer?.setData('text/plain', task.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => endDrag());
  card.addEventListener('click', () => openTask(task));
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openTask(task);
  });

  const remove = element('button', 'card-delete', '×');
  remove.type = 'button';
  remove.title = `Delete ${task.title}`;
  remove.setAttribute('aria-label', `Delete ${task.title}`);
  remove.addEventListener('click', (event) => {
    event.stopPropagation();
    vscode.postMessage({ type: 'deleteTask', id: task.id });
  });

  card.append(element('div', 'card-title-row', [element('p', 'card-title', task.title), remove]));

  const meta = element('div', 'card-meta');
  if (task.category !== '') meta.append(element('span', 'category', task.category));
  for (const tag of task.tags) meta.append(element('span', 'tag', `#${tag}`));
  if (meta.childElementCount > 0) card.append(meta);

  if (task.refs.length > 0) card.append(renderRefs(task.refs));

  const footer = element('div', 'card-footer', [element('span', 'card-id', idNumber(task.id))]);
  if (blocked) footer.append(element('span', 'card-blocked', 'blocked'));
  if (task.notes.trim() !== '') footer.append(element('span', 'card-has-notes', 'notes'));
  card.append(footer);

  return card;
}

function openTask(task: BoardTask): void {
  vscode.postMessage({ type: 'openTask', id: task.id, title: task.title });
}

function renderRefs(refs: string[]): HTMLElement {
  const list = element('div', 'refs');
  for (const ref of refs) {
    const button = element('button', 'ref', ref);
    button.type = 'button';
    button.title = `Open ${ref}`;
    button.addEventListener('click', (event) => {
      // Otherwise this bubbles to the card's own click handler, opening the ref and
      // the task document at once.
      event.stopPropagation();
      vscode.postMessage({ type: 'openRef', ref });
    });
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

// ---------------------------------------------------------------- drag and drop

/** The card currently being dragged, if any. Cleared on drop and on `dragend`. */
let dragState: { id: string } | undefined;

function handleDragOver(event: DragEvent, container: HTMLElement): void {
  if (!dragState) return;
  // Required for the element to become a valid drop target at all.
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  placeIndicator(container, insertionIndex(container, event.clientY, dragState.id));
}

function handleDrop(event: DragEvent, container: HTMLElement, status: BoardStatus): void {
  event.preventDefault();
  const dragging = dragState;
  if (!dragging) return;

  const idx = insertionIndex(container, event.clientY, dragging.id);
  const ids = cardIdsExcluding(container, dragging.id);
  const position = dropPosition(ids, idx);

  // Report where it landed; never the order. The host spawns `tasks move` and the
  // next `tasks` message is what actually places the card — see the module doc.
  vscode.postMessage({ type: 'move', id: dragging.id, status, ...position });
  endDrag();
}

/** Ends a drag, however it ended, and applies any render that was held back for it. */
function endDrag(): void {
  dragState = undefined;
  document.querySelectorAll('.drop-indicator').forEach((node) => node.remove());
  document.querySelectorAll('.card.dragging').forEach((node) => node.classList.remove('dragging'));

  if (pendingRender) {
    const { tasks, statuses, project } = pendingRender;
    pendingRender = undefined;
    renderBoard(tasks, statuses, project);
  }
}

/** The ids of a column's rendered cards, in order, excluding the one being dragged. */
function cardIdsExcluding(container: HTMLElement, excludeId: string): string[] {
  return [...container.querySelectorAll<HTMLElement>('.card')]
    .map((node) => node.dataset.id)
    .filter((id): id is string => id !== undefined && id !== excludeId);
}

/** Which gap `clientY` sits in among a column's cards, as an index into that list. */
function insertionIndex(container: HTMLElement, clientY: number, excludeId: string): number {
  const cards = [...container.querySelectorAll<HTMLElement>('.card')].filter(
    (node) => node.dataset.id !== excludeId,
  );
  for (const [index, card] of cards.entries()) {
    const rect = card.getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return index;
  }
  return cards.length;
}

function placeIndicator(container: HTMLElement, idx: number): void {
  const indicator = document.querySelector('.drop-indicator') ?? element('div', 'drop-indicator');
  const reference = [...container.querySelectorAll<HTMLElement>('.card')].filter(
    (node) => node.dataset.id !== dragState?.id,
  )[idx];
  if (reference) container.insertBefore(indicator, reference);
  else container.append(indicator);
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
