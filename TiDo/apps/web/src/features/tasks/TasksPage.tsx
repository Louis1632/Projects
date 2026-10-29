import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Subtask, Task } from '@tido/contracts';
import { api } from '../../lib/api';
import { useDashboard, useWorkspaceMutation } from '../../lib/queries';
import { useShell } from '../layout/AppShell';
import { defaultFilters, filtersActive, taskMatches, type TaskFilters } from './filters';
import { priorityLabels, statusLabels } from './labels';
import { TaskRow } from './TaskRow';

export function TasksPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { today, search, openEditor, notify } = useShell();
  const dashboard = useDashboard().data!;
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  const [newSection, setNewSection] = useState('');

  const toggle = useWorkspaceMutation((task: Task | Subtask) =>
    api.completeTask(task.id, task.status !== 'done'),
  );
  const move = useWorkspaceMutation((input: { task: Task; position: number }) =>
    api.moveTask(input.task.id, {
      sectionId: input.task.sectionId,
      position: input.position,
      revision: input.task.revision,
    }),
  );
  const addSection = useWorkspaceMutation((input: { projectId: string; name: string }) =>
    api.createSection(input.projectId, input.name),
  );
  const archiveList = useWorkspaceMutation((input: { id: string; revision: number }) =>
    api.updateProject(input.id, { archived: true, revision: input.revision }),
  );

  const run = (promise: Promise<unknown>) =>
    promise.catch((error: unknown) =>
      notify(error instanceof Error ? error.message : 'Could not save.'),
    );

  const projects = projectId
    ? dashboard.projects.filter((project) => project.id === projectId)
    : dashboard.projects;
  if (projectId && projects.length === 0) {
    return (
      <section className="screen">
        <p className="empty-inline">That list no longer exists.</p>
      </section>
    );
  }
  const effective = { ...filters, search };
  const set = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const activeMembers = dashboard.members.filter((member) => member.active);
  const single = projectId ? projects[0] : undefined;

  const submitSection = (event: FormEvent) => {
    event.preventDefault();
    if (!single || !newSection.trim()) return;
    void run(
      addSection
        .mutateAsync({ projectId: single.id, name: newSection.trim() })
        .then(() => setNewSection('')),
    );
  };

  return (
    <section className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Shared workspace</p>
          <h1>{single ? single.name : 'All tasks'}</h1>
          <p>Keep the household moving, together.</p>
        </div>
        {single && (
          <button
            className="text-button danger"
            onClick={() => {
              if (window.confirm(`Archive "${single.name}"? Its tasks are kept but hidden.`)) {
                void run(
                  archiveList
                    .mutateAsync({ id: single.id, revision: single.revision })
                    .then(() => navigate('/tasks')),
                );
              }
            }}
          >
            Archive list
          </button>
        )}
      </div>

      <div className="filters" role="group" aria-label="Filters">
        <label>
          Status
          <select
            value={filters.status}
            onChange={(event) => set('status', event.target.value as TaskFilters['status'])}
          >
            <option value="all">All statuses</option>
            <option value="open">Not done</option>
            {Object.entries(statusLabels).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned
          <select
            value={filters.assigneeId}
            onChange={(event) => set('assigneeId', event.target.value)}
          >
            <option value="all">Everyone</option>
            <option value="none">Unassigned</option>
            {activeMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={filters.priority}
            onChange={(event) => set('priority', event.target.value as TaskFilters['priority'])}
          >
            <option value="all">Any priority</option>
            {Object.entries(priorityLabels).map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Label
          <select value={filters.labelId} onChange={(event) => set('labelId', event.target.value)}>
            <option value="all">Any label</option>
            {dashboard.labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due
          <select
            value={filters.due}
            onChange={(event) => set('due', event.target.value as TaskFilters['due'])}
          >
            <option value="all">Any time</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="week">Next 7 days</option>
            <option value="none">No date</option>
          </select>
        </label>
        {filtersActive(filters) && (
          <button className="text-button" onClick={() => setFilters(defaultFilters)}>
            Clear filters
          </button>
        )}
      </div>

      {dashboard.projects.length === 0 && (
        <div className="empty-state">
          <h2>Start with a list</h2>
          <p>
            Lists group related tasks, such as “Groceries” or “House admin”. Create one from the
            sidebar.
          </p>
        </div>
      )}

      <div className="task-board">
        {projects.map((project) => (
          <div className="project-block" key={project.id}>
            {!single && (
              <h2>
                <span
                  className="project-dot"
                  style={{ background: project.color ?? 'var(--teal)' }}
                />
                {project.name}
              </h2>
            )}
            {project.sections.map((section) => {
              const visible = section.tasks.filter((task) => taskMatches(task, effective, today));
              return (
                <section
                  className="section-card"
                  key={section.id}
                  aria-label={`${project.name} – ${section.name}`}
                >
                  <div className="section-heading">
                    <h3>{section.name}</h3>
                    <button
                      className="text-button"
                      onClick={() => openEditor({ mode: 'create', sectionId: section.id })}
                    >
                      + Add task
                    </button>
                  </div>
                  {visible.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      members={dashboard.members}
                      today={today}
                      onEdit={(item) => openEditor({ mode: 'edit', task: item })}
                      onToggle={(item) => void run(toggle.mutateAsync(item))}
                      onMove={(item, direction) => {
                        const index = section.tasks.findIndex(
                          (candidate) => candidate.id === item.id,
                        );
                        const neighbour = section.tasks[index + direction];
                        if (neighbour)
                          void run(move.mutateAsync({ task: item, position: index + direction }));
                      }}
                    />
                  ))}
                  {visible.length === 0 && (
                    <p className="empty-inline">
                      {section.tasks.length ? 'No matching tasks.' : 'No tasks yet.'}
                    </p>
                  )}
                </section>
              );
            })}
            {single && (
              <form className="inline-form" onSubmit={submitSection}>
                <label className="sr-only" htmlFor="new-section">
                  New section name
                </label>
                <input
                  id="new-section"
                  value={newSection}
                  onChange={(event) => setNewSection(event.target.value)}
                  placeholder="New section name"
                  maxLength={120}
                />
                <button className="secondary-button" disabled={!newSection.trim()}>
                  Add section
                </button>
              </form>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
