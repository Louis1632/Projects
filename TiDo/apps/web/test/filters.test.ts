import { describe, expect, it } from 'vitest';
import { activeFilterCount, defaultFilters, taskMatches } from '../src/features/tasks/filters';
import { makeTask } from './fixtures';

const today = '2026-06-15';

describe('taskMatches', () => {
  it('filters by status, including "not done"', () => {
    const done = makeTask({ status: 'done' });
    expect(taskMatches(done, { ...defaultFilters, status: 'open' }, today)).toBe(false);
    expect(taskMatches(done, { ...defaultFilters, status: 'done' }, today)).toBe(true);
  });

  it('filters by assignee, including unassigned', () => {
    const assigned = makeTask({ assigneeId: 'sam' });
    expect(taskMatches(assigned, { ...defaultFilters, assigneeId: 'sam' }, today)).toBe(true);
    expect(taskMatches(assigned, { ...defaultFilters, assigneeId: 'none' }, today)).toBe(false);
    expect(taskMatches(makeTask(), { ...defaultFilters, assigneeId: 'none' }, today)).toBe(true);
  });

  it('filters by due window', () => {
    const overdue = makeTask({ dueDate: '2026-06-10' });
    const later = makeTask({ dueDate: '2026-06-20' });
    expect(taskMatches(overdue, { ...defaultFilters, due: 'overdue' }, today)).toBe(true);
    expect(
      taskMatches(
        makeTask({ dueDate: '2026-06-10', status: 'done' }),
        { ...defaultFilters, due: 'overdue' },
        today,
      ),
    ).toBe(false);
    expect(taskMatches(later, { ...defaultFilters, due: 'week' }, today)).toBe(true);
    expect(
      taskMatches(makeTask({ dueDate: '2026-06-22' }), { ...defaultFilters, due: 'week' }, today),
    ).toBe(false);
    expect(taskMatches(makeTask(), { ...defaultFilters, due: 'none' }, today)).toBe(true);
  });

  it('hides archived tasks and reports active filters', () => {
    expect(
      taskMatches(makeTask({ archivedAt: '2026-01-01T00:00:00Z' }), defaultFilters, today),
    ).toBe(false);
    expect(activeFilterCount(defaultFilters)).toBe(0);
    expect(activeFilterCount({ ...defaultFilters, priority: 'high', due: 'today' })).toBe(2);
  });
});
