import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type {
  Dashboard,
  RecurrenceScope,
  Subtask,
  Task,
  TaskPriority,
  TaskStatus,
  TaskUpdateInput,
} from '@tido/contracts';
import { api, errorMessage } from '../../lib/api';
import { prettyDay } from '../../lib/dates';
import { invalidateWorkspace } from '../../lib/queries';
import { draftToRule, ruleToDraft, type RecurrenceDraft } from '../../lib/recurrence';
import type { EditorTarget } from '../layout/AppShell';
import { RecurrenceEditor } from '../recurrence/RecurrenceEditor';
import { ScopeDialog } from '../recurrence/ScopeDialog';
import { priorityLabels, statusLabels } from './labels';

interface Props {
  target: EditorTarget;
  dashboard: Dashboard;
  today: string;
  onClose: () => void;
  onOpenTask: (task: Task | Subtask) => void;
}

type PendingScope = { action: 'save'; allowOccurrence: boolean } | { action: 'delete' };

const sameLabels = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();

export function TaskEditor({ target, dashboard, today, onClose, onOpenTask }: Props) {
  const client = useQueryClient();
  const initial = target.mode === 'edit' ? target.task : undefined;
  const live = useQuery({
    queryKey: ['task', initial?.id],
    queryFn: () => api.getTask(initial!.id),
    enabled: !!initial && !initial.parentTaskId,
    initialData: initial && 'subtasks' in initial ? initial : undefined,
  });
  const task = (live.data ?? initial) as Task | Subtask | undefined;
  const isSubtask = !!task?.parentTaskId;
  const sections = dashboard.projects.flatMap((project) =>
    project.sections.map((section) => ({ ...section, label: `${project.name} › ${section.name}` })),
  );

  const [title, setTitle] = useState(initial?.title ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'todo');
  const [priority, setPriority] = useState<TaskPriority>(initial?.priority ?? 'medium');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [dueDate, setDueDate] = useState(
    initial?.dueDate ?? (target.mode === 'create' ? (target.dueDate ?? '') : ''),
  );
  const [assigneeId, setAssigneeId] = useState(initial?.assigneeId ?? '');
  const [labelIds, setLabelIds] = useState<string[]>(
    initial?.labels.map((label) => label.id) ?? [],
  );
  const [sectionId, setSectionId] = useState(
    initial?.sectionId ??
      (target.mode === 'create' ? target.sectionId : undefined) ??
      sections[0]?.id ??
      '',
  );
  const anchor = dueDate || initial?.recurrence?.occurrenceDate || today;
  const [recurrence, setRecurrence] = useState<RecurrenceDraft>(() =>
    ruleToDraft(initial?.recurrence?.rrule, anchor),
  );
  // The stored rule is kept verbatim unless the repeat controls are actually used.
  const [recurrenceTouched, setRecurrenceTouched] = useState(false);
  const [newSubtask, setNewSubtask] = useState('');
  const [pendingSubtasks, setPendingSubtasks] = useState<string[]>([]);
  const [repeatSubtask, setRepeatSubtask] = useState(true);
  const [newLabel, setNewLabel] = useState('');
  const [scopePrompt, setScopePrompt] = useState<PendingScope | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rule = recurrenceTouched
    ? draftToRule(recurrence, anchor)
    : (initial?.recurrence?.rrule ?? null);
  const refresh = () => invalidateWorkspace(client);
  const fail = (caught: unknown) => setError(errorMessage(caught));

  const fieldPatch = () => ({
    title: title.trim(),
    notes: notes.trim() ? notes : null,
    status,
    priority,
    startDate: startDate || null,
    dueDate: dueDate || null,
    assigneeId: assigneeId || null,
    labelIds,
  });

  const changedFromTask = (current: Task | Subtask) =>
    title.trim() !== current.title ||
    (notes.trim() ? notes : null) !== current.notes ||
    status !== current.status ||
    priority !== current.priority ||
    (startDate || null) !== current.startDate ||
    (dueDate || null) !== current.dueDate ||
    (assigneeId || null) !== current.assigneeId ||
    !sameLabels(
      labelIds,
      current.labels.map((label) => label.id),
    );

  const create = async () => {
    const created = await api.createTask({
      sectionId,
      ...fieldPatch(),
      recurrence: rule ? { rrule: rule, startsOn: dueDate || today } : null,
    });
    for (const subtaskTitle of pendingSubtasks) {
      await api.createTask({
        sectionId,
        parentTaskId: created.id,
        title: subtaskTitle,
        repeatSubtask: true,
      });
    }
  };

  const update = async (current: Task | Subtask, scope?: RecurrenceScope) => {
    const patch: TaskUpdateInput = { revision: current.revision, ...fieldPatch(), scope };
    if (current.recurrence) {
      if (rule !== current.recurrence.rrule) patch.recurrence = rule ? { rrule: rule } : null;
    } else if (rule && !isSubtask) {
      patch.recurrence = { rrule: rule, startsOn: dueDate || today };
    }
    let updated = await api.updateTask(current.id, patch);
    if (!isSubtask && sectionId !== current.sectionId) {
      updated = await api.moveTask(updated.id, {
        sectionId,
        position: 10_000,
        revision: updated.revision,
      });
    }
    return updated;
  };

  const submit = async (event?: FormEvent, scope?: RecurrenceScope) => {
    event?.preventDefault();
    if (!title.trim()) return setError('A task needs a title.');
    if (startDate && dueDate && startDate > dueDate)
      return setError('The due date cannot be before the start date.');
    if (recurrence.preset === 'weekly' && recurrence.weekdays.length === 0)
      return setError('Pick at least one weekday.');

    if (task?.recurrence && !scope) {
      const ruleChanged = rule !== task.recurrence.rrule;
      if (!ruleChanged && !changedFromTask(task) && sectionId === task.sectionId) return onClose();
      if (ruleChanged || changedFromTask(task)) {
        return setScopePrompt({ action: 'save', allowOccurrence: !ruleChanged });
      }
    }

    setSaving(true);
    setError(null);
    try {
      if (task) await update(task, scope);
      else await create();
      await refresh();
      onClose();
    } catch (caught) {
      fail(caught);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (scope?: RecurrenceScope) => {
    if (!task) return;
    if (task.recurrence && !scope) return setScopePrompt({ action: 'delete' });
    if (!task.recurrence && !window.confirm(`Delete "${task.title}"? It will be archived.`)) return;
    try {
      await api.deleteTask(task.id, scope);
      await refresh();
      onClose();
    } catch (caught) {
      fail(caught);
    }
  };

  const addSubtask = async (event: FormEvent) => {
    event.preventDefault();
    const value = newSubtask.trim();
    if (!value) return;
    if (!task) {
      setPendingSubtasks((current) => [...current, value]);
      setNewSubtask('');
      return;
    }
    try {
      await api.createTask({
        sectionId: task.sectionId,
        parentTaskId: task.id,
        title: value,
        repeatSubtask: !!task.recurrence && repeatSubtask,
      });
      setNewSubtask('');
      await refresh();
    } catch (caught) {
      fail(caught);
    }
  };

  const toggleSubtask = async (subtask: Subtask) => {
    try {
      await api.completeTask(subtask.id, subtask.status !== 'done');
      await refresh();
    } catch (caught) {
      fail(caught);
    }
  };

  const removeSubtask = async (subtask: Subtask) => {
    try {
      await api.deleteTask(subtask.id);
      await refresh();
    } catch (caught) {
      fail(caught);
    }
  };

  const createLabel = async () => {
    if (!newLabel.trim()) return;
    try {
      const label = await api.createLabel(newLabel.trim());
      setLabelIds((current) => [...current, label.id]);
      setNewLabel('');
      await refresh();
    } catch (caught) {
      fail(caught);
    }
  };

  if (sections.length === 0 && !task) {
    return (
      <div className="modal-backdrop" role="presentation">
        <section className="task-modal" role="dialog" aria-modal="true" aria-label="New task">
          <p>Create a list from the sidebar before adding your first task.</p>
          <div className="modal-actions">
            <button className="primary-button" onClick={onClose}>
              OK
            </button>
          </div>
        </section>
      </div>
    );
  }

  const parent = isSubtask
    ? dashboard.projects
        .flatMap((project) => project.sections.flatMap((section) => section.tasks))
        .find((candidate) => candidate.id === task!.parentTaskId)
    : undefined;
  const subtasks = task && 'subtasks' in task ? task.subtasks : [];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <section
        className="task-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-editor-title"
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">
              {task ? (isSubtask ? 'Update subtask' : 'Update task') : 'New task'}
            </p>
            <h2 id="task-editor-title">{task ? task.title : 'Add a task'}</h2>
            {parent && (
              <button className="text-button" onClick={() => onOpenTask(parent)}>
                ← Part of “{parent.title}”
              </button>
            )}
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <form className="task-form" onSubmit={(event) => void submit(event)}>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <label>
            Title
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What needs to happen?"
              maxLength={500}
            />
          </label>
          <label>
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add helpful context"
              rows={3}
            />
          </label>
          <div className="form-grid">
            <label>
              Status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
              >
                {Object.entries(statusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
              >
                {Object.entries(priorityLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start date
              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </label>
            <label>
              Due date
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              Assign to
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
                <option value="">Unassigned</option>
                {dashboard.members
                  .filter((member) => member.active || member.id === assigneeId)
                  .map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.displayName}
                    </option>
                  ))}
              </select>
            </label>
            {!isSubtask && (
              <label>
                List and section
                <select value={sectionId} onChange={(event) => setSectionId(event.target.value)}>
                  {sections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          <fieldset>
            <legend>Labels</legend>
            <div className="label-options">
              {dashboard.labels.map((label) => (
                <label className="checkbox-label" key={label.id}>
                  <input
                    type="checkbox"
                    checked={labelIds.includes(label.id)}
                    onChange={(event) =>
                      setLabelIds((current) =>
                        event.target.checked
                          ? [...current, label.id]
                          : current.filter((id) => id !== label.id),
                      )
                    }
                  />
                  {label.name}
                </label>
              ))}
              <span className="inline-field">
                <input
                  aria-label="New label"
                  value={newLabel}
                  onChange={(event) => setNewLabel(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void createLabel();
                    }
                  }}
                  placeholder="New label"
                  maxLength={60}
                />
                <button
                  type="button"
                  className="text-button"
                  onClick={() => void createLabel()}
                  disabled={!newLabel.trim()}
                >
                  Add
                </button>
              </span>
            </div>
          </fieldset>

          {!isSubtask && (
            <RecurrenceEditor
              draft={recurrence}
              anchor={anchor}
              onChange={(draft) => {
                setRecurrenceTouched(true);
                setRecurrence(draft);
              }}
            />
          )}
          {task?.recurrence?.detached && (
            <p className="helper-copy">
              This occurrence was edited on its own and no longer follows series-wide edits.
            </p>
          )}

          <div className="modal-actions">
            {task && (
              <button type="button" className="text-button danger" onClick={() => void remove()}>
                Delete
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="secondary-button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" disabled={saving}>
              {saving ? 'Saving…' : task ? 'Save changes' : 'Create task'}
            </button>
          </div>
        </form>

        {!isSubtask && (
          <section className="subtask-panel" aria-label="Subtasks">
            <h3>Subtasks</h3>
            <ul className="subtask-list editable">
              {subtasks.map((subtask) => (
                <li
                  key={subtask.id}
                  className={subtask.status === 'done' ? 'subtask done' : 'subtask'}
                >
                  <button
                    className="subtask-check"
                    aria-label={
                      subtask.status === 'done'
                        ? `Reopen ${subtask.title}`
                        : `Complete ${subtask.title}`
                    }
                    onClick={() => void toggleSubtask(subtask)}
                  >
                    {subtask.status === 'done' ? '✓' : '○'}
                  </button>
                  <button className="subtask-title" onClick={() => onOpenTask(subtask)}>
                    {subtask.title}
                  </button>
                  <button
                    className="icon-button small"
                    aria-label={`Delete ${subtask.title}`}
                    onClick={() => void removeSubtask(subtask)}
                  >
                    ×
                  </button>
                </li>
              ))}
              {pendingSubtasks.map((subtaskTitle, index) => (
                <li key={`${subtaskTitle}-${index}`} className="subtask">
                  <span aria-hidden="true">○</span>
                  <span className="subtask-title">{subtaskTitle}</span>
                  <button
                    className="icon-button small"
                    aria-label={`Remove ${subtaskTitle}`}
                    onClick={() =>
                      setPendingSubtasks((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <form className="inline-form" onSubmit={(event) => void addSubtask(event)}>
              <label className="sr-only" htmlFor="new-subtask">
                New subtask
              </label>
              <input
                id="new-subtask"
                value={newSubtask}
                onChange={(event) => setNewSubtask(event.target.value)}
                placeholder="Add a subtask"
                maxLength={500}
              />
              <button className="secondary-button" disabled={!newSubtask.trim()}>
                Add
              </button>
            </form>
            {task?.recurrence && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={repeatSubtask}
                  onChange={(event) => setRepeatSubtask(event.target.checked)}
                />
                Also add new subtasks to future occurrences
              </label>
            )}
          </section>
        )}

        {task && <CompletionHistory taskId={task.id} today={today} />}
      </section>

      {scopePrompt && (
        <ScopeDialog
          action={scopePrompt.action}
          allowOccurrence={scopePrompt.action === 'delete' || scopePrompt.allowOccurrence}
          onCancel={() => setScopePrompt(null)}
          onChoose={(scope) => {
            const prompt = scopePrompt;
            setScopePrompt(null);
            if (prompt.action === 'save') void submit(undefined, scope);
            else void remove(scope);
          }}
        />
      )}
    </div>
  );
}

function CompletionHistory({ taskId, today }: { taskId: string; today: string }) {
  const [open, setOpen] = useState(false);
  const history = useQuery({
    queryKey: ['completions', taskId],
    queryFn: () => api.completions(taskId),
    enabled: open,
  });
  return (
    <details
      className="history"
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>Completion history</summary>
      {history.isPending && open && <p className="empty-inline">Loading…</p>}
      {history.data?.length === 0 && <p className="empty-inline">Not completed yet.</p>}
      <ul>
        {history.data?.map((entry, index) => (
          <li key={index}>
            {entry.action === 'completed' ? '✓ Completed' : '↺ Reopened'} by{' '}
            {entry.actorName ?? 'a former member'} ·{' '}
            {prettyDay(entry.occurredAt.slice(0, 10), today)}
          </li>
        ))}
      </ul>
    </details>
  );
}
