import type { Task, TaskPriority, TaskStatus } from '@tido/contracts';
import { addDays } from '../../lib/dates';

export type DueFilter = 'all' | 'overdue' | 'today' | 'week' | 'none';

export interface TaskFilters {
  search: string;
  status: TaskStatus | 'open' | 'all';
  assigneeId: string | 'all' | 'none';
  priority: TaskPriority | 'all';
  labelId: string | 'all';
  due: DueFilter;
}

export const defaultFilters: TaskFilters = {
  search: '',
  status: 'all',
  assigneeId: 'all',
  priority: 'all',
  labelId: 'all',
  due: 'all',
};

function matchesDue(task: Task, due: DueFilter, today: string) {
  switch (due) {
    case 'all':
      return true;
    case 'none':
      return !task.dueDate;
    case 'overdue':
      return !!task.dueDate && task.dueDate < today && task.status !== 'done';
    case 'today':
      return task.dueDate === today;
    case 'week':
      return !!task.dueDate && task.dueDate >= today && task.dueDate <= addDays(today, 6);
  }
}

/** Client-side filtering of the dashboard snapshot; a task matches if every filter does. */
export function taskMatches(task: Task, filters: TaskFilters, today: string): boolean {
  if (task.archivedAt) return false;
  if (
    filters.status === 'open'
      ? task.status === 'done'
      : filters.status !== 'all' && task.status !== filters.status
  ) {
    return false;
  }
  if (
    filters.assigneeId === 'none'
      ? task.assigneeId
      : filters.assigneeId !== 'all' && task.assigneeId !== filters.assigneeId
  ) {
    return false;
  }
  if (filters.priority !== 'all' && task.priority !== filters.priority) return false;
  if (filters.labelId !== 'all' && !task.labels.some((label) => label.id === filters.labelId))
    return false;
  if (!matchesDue(task, filters.due, today)) return false;

  const query = filters.search.trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    task.title,
    task.notes ?? '',
    ...task.labels.map((label) => label.name),
    ...task.subtasks.map((subtask) => subtask.title),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query);
}

export function filtersActive(filters: TaskFilters): boolean {
  return (Object.keys(defaultFilters) as (keyof TaskFilters)[]).some(
    (key) => key !== 'search' && filters[key] !== defaultFilters[key],
  );
}
