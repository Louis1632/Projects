import { useMemo, useState } from 'react';
import type { Task } from '@tido/contracts';
import {
  addDays,
  monthGrid,
  monthTitle,
  prettyDay,
  shiftMonth,
  startOfMonth,
} from '../../lib/dates';
import { useCalendar, useDashboard } from '../../lib/queries';
import { useShell } from '../layout/AppShell';

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const dayOf = (task: Task) => task.dueDate ?? task.startDate ?? '';

export function groupByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const day = dayOf(task);
    map.set(day, [...(map.get(day) ?? []), task]);
  }
  return map;
}

export function CalendarPage() {
  const { today, openEditor } = useShell();
  const dashboard = useDashboard().data!;
  const [month, setMonth] = useState(() => startOfMonth(today));
  const [projectId, setProjectId] = useState('all');
  const [assigneeId, setAssigneeId] = useState('all');
  const grid = monthGrid(month);
  const monthTasks = useCalendar(grid[0]!, grid[41]!);
  const agendaTasks = useCalendar(today, addDays(today, 30));

  const filter = useMemo(
    () => (task: Task) =>
      (projectId === 'all' || task.projectId === projectId) &&
      (assigneeId === 'all' || task.assigneeId === assigneeId),
    [projectId, assigneeId],
  );

  const byDay = groupByDay((monthTasks.data ?? []).filter(filter));
  const agenda = (agendaTasks.data ?? []).filter((task) => filter(task) && task.status !== 'done');
  const agendaByDay = [...groupByDay(agenda).entries()].slice(0, 14);

  return (
    <section className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Plan ahead</p>
          <h1>Calendar</h1>
          <p>Recurring tasks appear on every date they repeat.</p>
        </div>
      </div>

      <div className="filters" role="group" aria-label="Filters">
        <label>
          List
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">All lists</option>
            {dashboard.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="all">Everyone</option>
            {dashboard.members
              .filter((member) => member.active)
              .map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="calendar-layout">
        <div className="calendar-panel">
          <div className="calendar-toolbar">
            <button
              className="icon-button"
              aria-label="Previous month"
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              ‹
            </button>
            <h2 aria-live="polite">{monthTitle(month)}</h2>
            <button
              className="icon-button"
              aria-label="Next month"
              onClick={() => setMonth(shiftMonth(month, 1))}
            >
              ›
            </button>
            <button className="text-button" onClick={() => setMonth(startOfMonth(today))}>
              Today
            </button>
          </div>
          {monthTasks.isError && <p className="form-error">Could not load the calendar.</p>}
          <div className="calendar-grid" role="grid" aria-label={monthTitle(month)}>
            {WEEKDAY_NAMES.map((name) => (
              <div className="weekday" role="columnheader" key={name}>
                {name}
              </div>
            ))}
            {grid.map((day) => {
              const items = byDay.get(day) ?? [];
              const classes = ['calendar-day'];
              if (day.slice(0, 7) !== month.slice(0, 7)) classes.push('muted-day');
              if (day === today) classes.push('today');
              return (
                <div key={day} className={classes.join(' ')} role="gridcell" data-day={day}>
                  <button
                    className="day-number"
                    aria-label={`Add a task on ${prettyDay(day)}`}
                    onClick={() => openEditor({ mode: 'create', dueDate: day })}
                  >
                    {Number(day.slice(8))}
                  </button>
                  {items.slice(0, 3).map((task) => (
                    <button
                      key={task.id}
                      className={task.status === 'done' ? 'calendar-task done' : 'calendar-task'}
                      onClick={() => openEditor({ mode: 'edit', task })}
                      title={task.title}
                    >
                      {task.recurrence && <span aria-label="Repeats">↻ </span>}
                      {task.title}
                    </button>
                  ))}
                  {items.length > 3 && <small>+{items.length - 3} more</small>}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="agenda" aria-label="Upcoming">
          <h2>Upcoming</h2>
          {agendaByDay.length === 0 && (
            <p className="empty-inline">Nothing due in the next 30 days.</p>
          )}
          {agendaByDay.map(([day, items]) => (
            <div className="agenda-day" key={day}>
              <h3 className="agenda-date">{prettyDay(day, today)}</h3>
              {items.map((task) => {
                const project = dashboard.projects.find(
                  (candidate) => candidate.id === task.projectId,
                );
                return (
                  <button
                    className="agenda-item"
                    key={task.id}
                    onClick={() => openEditor({ mode: 'edit', task })}
                  >
                    <strong>
                      {task.recurrence && '↻ '}
                      {task.title}
                    </strong>
                    <small>{project?.name ?? 'Archived list'}</small>
                  </button>
                );
              })}
            </div>
          ))}
        </aside>
      </div>
    </section>
  );
}
