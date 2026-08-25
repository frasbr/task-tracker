import type { Task } from '@task-tracker/core';

/**
 * Output formatting.
 *
 * Two modes, and the distinction is the point: the default is compact lines meant to
 * be read — by a person scanning a terminal or an agent spending tokens on the result
 * — and `--json` is the machine path the extension uses. Neither is a pretty-printed
 * version of the other.
 *
 * Compact output stays on one line per task so `tasks list | grep` behaves.
 */

/** One task, one line: id, status, category, title, tags. */
export function formatLine(
  task: Task,
  widths: { id: number; status: number; category: number },
): string {
  const parts = [
    task.id.padEnd(widths.id),
    task.status.padEnd(widths.status),
    task.category.padEnd(widths.category),
    task.title,
  ];
  const line = parts.join('  ').trimEnd();
  const tags = task.tags.map((tag) => `#${tag}`).join(' ');
  return tags === '' ? line : `${line}  ${tags}`;
}

export function formatList(tasks: readonly Task[]): string {
  if (tasks.length === 0) return '';
  // Widths come from the rows on screen, so a status named anything still lines up.
  const widths = {
    id: Math.max(...tasks.map((task) => task.id.length)),
    status: Math.max(...tasks.map((task) => task.status.length)),
    category: Math.max(...tasks.map((task) => task.category.length)),
  };
  return tasks.map((task) => formatLine(task, widths)).join('\n');
}

/**
 * A count per column, for the empty case and for `tasks list` with no filter. The columns
 * and their order are the project's own, passed in rather than assumed.
 */
export function formatSummary(tasks: readonly Task[], statuses: readonly string[]): string {
  const counts = new Map<string, number>(statuses.map((status) => [status, 0]));
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  return statuses.map((status) => `${status} ${counts.get(status) ?? 0}`).join('  ·  ');
}

/** One task in full, for `tasks show`. */
export function formatTask(task: Task): string {
  const lines = [
    `${task.id}  ${task.title}`,
    '',
    `  status    ${task.status}`,
    `  category  ${task.category || '—'}`,
    `  tags      ${task.tags.length > 0 ? task.tags.join(', ') : '—'}`,
    `  refs      ${task.refs.length > 0 ? task.refs.join('\n            ') : '—'}`,
    `  created   ${task.created}`,
    `  updated   ${task.updated}`,
  ];

  if (task.notes.trim() !== '') {
    lines.push('', ...task.notes.split('\n').map((line) => (line === '' ? '' : `  ${line}`)));
  }

  return lines.join('\n');
}

export function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
