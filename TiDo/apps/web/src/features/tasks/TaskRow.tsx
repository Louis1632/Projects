import type { CSSProperties } from 'react';
import type { Member, Subtask, Task } from '@tido/contracts';
import { prettyDay } from '../../lib/dates';
import { describeRule } from '../../lib/recurrence';
import { priorityLabels } from './labels';

interface TaskRowProps {
  task: Task;
  members: Member[];
  today: string;
  onEdit: (task: Task | Subtask) => void;
  onToggle: (task: Task | Subtask) => void;
  onMove?: (task: Task, direction: -1 | 1) => void;
  showSection?: string;
}

export function TaskRow({
  task,
  members,
  today,
  onEdit,
  onToggle,
  onMove,
  showSection,
}: TaskRowProps) {
  const assignee = members.find((member) => member.id === task.assigneeId);
  const done = task.status === 'done';
  const openSubtasks = task.subtasks.filter((subtask) => subtask.status !== 'done').length;
  return (
    <article className={done ? 'task-row completed' : 'task-row'} data-testid="task-row">
      <button
        className="check-button"
        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        onClick={() => onToggle(task)}
      >
        {done ? '✓' : ''}
      </button>
      <button className="task-main" onClick={() => onEdit(task)}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {showSection && <span>{showSection}</span>}
          {task.recurrence && (
            <span title={task.recurrence.rrule}>
              ↻ {describeRule(task.recurrence.rrule, task.recurrence.startsOn)}
            </span>
          )}
          {task.dueDate && (
            <span className={task.dueDate < today && !done ? 'overdue' : ''}>
              ◷ {prettyDay(task.dueDate, today)}
            </span>
          )}
          {assignee && <span>◉ {assignee.displayName}</span>}
          {task.subtasks.length > 0 && (
            <span>
              ☑ {task.subtasks.length - openSubtasks}/{task.subtasks.length}
            </span>
          )}
          {task.labels.map((label) => (
            <span
              className="label-chip"
              key={label.id}
              style={{ '--label-color': label.color ?? 'var(--teal)' } as CSSProperties}
            >
              {label.name}
            </span>
          ))}
        </span>
      </button>
      <span
        className={`priority priority-${task.priority}`}
        title={`${priorityLabels[task.priority]} priority`}
      >
        <span className="sr-only">{priorityLabels[task.priority]} priority</span>●
      </span>
      {onMove && (
        <span className="row-actions">
          <button
            className="icon-button small"
            aria-label={`Move ${task.title} up`}
            onClick={() => onMove(task, -1)}
          >
            ↑
          </button>
          <button
            className="icon-button small"
            aria-label={`Move ${task.title} down`}
            onClick={() => onMove(task, 1)}
          >
            ↓
          </button>
        </span>
      )}
      {task.subtasks.length > 0 && (
        <ul className="subtask-list">
          {task.subtasks.map((subtask) => (
            <li key={subtask.id} className={subtask.status === 'done' ? 'subtask done' : 'subtask'}>
              <button
                className="subtask-check"
                aria-label={
                  subtask.status === 'done'
                    ? `Reopen ${subtask.title}`
                    : `Complete ${subtask.title}`
                }
                onClick={() => onToggle(subtask)}
              >
                {subtask.status === 'done' ? '✓' : '○'}
              </button>
              <button className="subtask-title" onClick={() => onEdit(subtask)}>
                {subtask.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
