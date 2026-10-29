import type { CSSProperties, HTMLAttributes } from 'react';
import type { Member, Subtask, Task } from '@tido/contracts';
import { prettyDay } from '../../lib/dates';
import { describeRule } from '../../lib/recurrence';
import { priorityLabels } from './labels';
import { QuickAdd } from './QuickAdd';

interface TaskRowProps {
  task: Task;
  members: Member[];
  today: string;
  onEdit: (task: Task | Subtask) => void;
  onToggle: (task: Task | Subtask) => void;
  onMove?: (task: Task, direction: -1 | 1) => void;
  /** Adds a subtask straight from the row, without opening the editor. */
  onAddSubtask?: (task: Task, title: string) => Promise<unknown>;
  showSection?: string;
  /** Drag-and-drop handlers, for views where rows can be dragged around. */
  dragProps?: HTMLAttributes<HTMLElement>;
  dragging?: boolean;
  /** Shows where a dragged task would land: just above this row. */
  dropBefore?: boolean;
}

export function TaskRow({
  task,
  members,
  today,
  onEdit,
  onToggle,
  onMove,
  onAddSubtask,
  showSection,
  dragProps,
  dragging,
  dropBefore,
}: TaskRowProps) {
  const assignee = members.find((member) => member.id === task.assigneeId);
  const done = task.status === 'done';
  const openSubtasks = task.subtasks.filter((subtask) => subtask.status !== 'done').length;
  const classes = ['task-row'];
  if (done) classes.push('completed');
  if (dragging) classes.push('dragging');
  if (dropBefore) classes.push('drop-before');
  return (
    <article {...dragProps} className={classes.join(' ')} data-testid="task-row">
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
      {onAddSubtask && (
        <QuickAdd
          label="+ Subtask"
          buttonLabel={`Add a subtask to ${task.title}`}
          fieldLabel={`New subtask for ${task.title}`}
          placeholder="Subtask, then Enter"
          className="add-subtask"
          onAdd={(title) => onAddSubtask(task, title)}
        />
      )}
    </article>
  );
}
