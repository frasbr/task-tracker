import type { Task, TaskStatus } from '@task-tracker/core';
import { TASK_STATUSES } from '@task-tracker/core';

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

const STATUS_WIDTH = Math.max(...TASK_STATUSES.map((status) => status.length));

/** One task, one line: id, status, category, title, tags. */
export function formatLine(task: Task, widths: { id: number; category: number }): string {
  const parts = [
    task.id.padEnd(widths.id),
    task.status.padEnd(STATUS_WIDTH),
    task.category.padEnd(widths.category),
    task.title,
  ];
  const line = parts.join('  ').trimEnd();
  const tags = task.tags.map((tag) => `#${tag}`).join(' ');
  return tags === '' ? line : `${line}  ${tags}`;
}

export function formatList(tasks: readonly Task[]): string {
  if (tasks.length === 0) return '';
  const widths = {
    id: Math.max(...tasks.map((task) => task.id.length)),
    category: Math.max(...tasks.map((task) => task.category.length)),
  };
  return tasks.map((task) => formatLine(task, widths)).join('\n');
}

/** A count per column, for the empty case and for `tasks list` with no filter. */
export function formatSummary(tasks: readonly Task[]): string {
  const counts = new Map<TaskStatus, number>(TASK_STATUSES.map((status) => [status, 0]));
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  return TASK_STATUSES.map((status) => `${status} ${counts.get(status)}`).join('  ·  ');
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
