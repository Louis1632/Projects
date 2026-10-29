import { useState, type DragEvent } from 'react';
import { useParams } from 'react-router';
import type { Section, SectionWithTasks, Subtask, Task } from '@tido/contracts';
import { api } from '../../lib/api';
import { useDashboard, useWorkspaceMutation } from '../../lib/queries';
import { useShell } from '../layout/AppShell';
import { defaultFilters, filtersActive, taskMatches, type TaskFilters } from './filters';
import { priorityLabels, statusLabels } from './labels';
import { AddSection, SectionName } from './SectionControls';
import { TaskRow } from './TaskRow';

type Dragged = { kind: 'section'; section: Section } | { kind: 'task'; task: Task };

export function TasksPage() {
  const { projectId } = useParams();
  const { today, search, openEditor, notify } = useShell();
  const dashboard = useDashboard().data!;
  const [filters, setFilters] = useState<TaskFilters>(defaultFilters);
  // A section being renamed cannot be dragged, so its name field behaves like any other.
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  // The section or task id the dragged item would land on, for the drop highlight.
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const toggle = useWorkspaceMutation((task: Task | Subtask) =>
    api.completeTask(task.id, task.status !== 'done'),
  );
  const move = useWorkspaceMutation((input: { task: Task; sectionId: string; position: number }) =>
    api.moveTask(input.task.id, {
      sectionId: input.sectionId,
      position: input.position,
      revision: input.task.revision,
    }),
  );
  const moveSection = useWorkspaceMutation((input: { section: Section; position: number }) =>
    api.updateSection(input.section.id, {
      position: input.position,
      revision: input.section.revision,
    }),
  );
  const addSection = useWorkspaceMutation((input: { projectId: string; name: string }) =>
    api.createSection(input.projectId, input.name),
  );
  const renameSection = useWorkspaceMutation((input: { section: Section; name: string }) =>
    api.updateSection(input.section.id, { name: input.name, revision: input.section.revision }),
  );
  const addSubtask = useWorkspaceMutation((input: { task: Task; title: string }) =>
    api.createTask({
      sectionId: input.task.sectionId,
      parentTaskId: input.task.id,
      title: input.title,
      repeatSubtask: !!input.task.recurrence,
    }),
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

  const startDrag = (event: DragEvent<HTMLElement>, item: Dragged, image?: Element | null) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    // Firefox only starts a drag when some data is set.
    event.dataTransfer.setData('text/plain', item.kind === 'task' ? item.task.title : '');
    if (image) event.dataTransfer.setDragImage(image, 24, 24);
    setDragged(item);
  };
  const endDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const allowDrop = (event: DragEvent<HTMLElement>, targetId: string) => {
    if (!dragged) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(targetId);
  };

  /** Puts the task just before `before`, or at the end of the section without one. */
  const placeTask = (task: Task, section: SectionWithTasks, before?: Task) => {
    if (before?.id === task.id) return;
    const siblings = section.tasks.filter((candidate) => candidate.id !== task.id);
    const position = before
      ? siblings.findIndex((candidate) => candidate.id === before.id)
      : siblings.length;
    const current = section.tasks.findIndex((candidate) => candidate.id === task.id);
    if (current === position) return;
    void run(move.mutateAsync({ task, sectionId: section.id, position }));
  };
  const placeSection = (section: Section, sections: Section[], position: number) => {
    const current = sections.findIndex((candidate) => candidate.id === section.id);
    if (current === -1 || position < 0 || position >= sections.length || position === current)
      return;
    void run(moveSection.mutateAsync({ section, position }));
  };

  const dropOnSection = (
    event: DragEvent<HTMLElement>,
    section: SectionWithTasks,
    sections: Section[],
  ) => {
    event.preventDefault();
    if (dragged?.kind === 'task') placeTask(dragged.task, section);
    if (dragged?.kind === 'section' && dragged.section.projectId === section.projectId) {
      placeSection(
        dragged.section,
        sections,
        sections.findIndex((candidate) => candidate.id === section.id),
      );
    }
    endDrag();
  };

  return (
    <section className="screen">
      <div className="screen-heading">
        <div>
          <p className="eyebrow">Shared workspace</p>
          <h1>{single ? single.name : 'All tasks'}</h1>
          <p>Keep the household moving, together.</p>
        </div>
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
            <div className="section-columns">
              {project.sections.map((section, sectionIndex) => {
                const visible = section.tasks.filter((task) => taskMatches(task, effective, today));
                const classes = ['section-card'];
                if (dragged?.kind === 'section' && dragged.section.id === section.id)
                  classes.push('dragging');
                if (dropTarget === section.id) classes.push('drop-target');
                return (
                  <section
                    className={classes.join(' ')}
                    key={section.id}
                    aria-label={`${project.name} – ${section.name}`}
                    onDragOver={(event) => {
                      if (
                        dragged?.kind === 'task' ||
                        dragged?.section.projectId === section.projectId
                      )
                        allowDrop(event, section.id);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setDropTarget(null);
                    }}
                    onDrop={(event) => dropOnSection(event, section, project.sections)}
                  >
                    <div
                      className="section-heading"
                      draggable={renaming !== section.id}
                      title="Drag to move this section"
                      onDragStart={(event) =>
                        startDrag(
                          event,
                          { kind: 'section', section },
                          event.currentTarget.parentElement,
                        )
                      }
                      onDragEnd={endDrag}
                    >
                      <span className="drag-grip" aria-hidden="true">
                        ⠿
                      </span>
                      <SectionName
                        name={section.name}
                        onRename={(name) => run(renameSection.mutateAsync({ section, name }))}
                        onEditingChange={(editing) => setRenaming(editing ? section.id : null)}
                      />
                      <span className="row-actions">
                        <button
                          className="icon-button small"
                          aria-label={`Move ${section.name} left`}
                          disabled={sectionIndex === 0}
                          onClick={() => placeSection(section, project.sections, sectionIndex - 1)}
                        >
                          ←
                        </button>
                        <button
                          className="icon-button small"
                          aria-label={`Move ${section.name} right`}
                          disabled={sectionIndex === project.sections.length - 1}
                          onClick={() => placeSection(section, project.sections, sectionIndex + 1)}
                        >
                          →
                        </button>
                      </span>
                    </div>
                    {visible.map((task) => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        members={dashboard.members}
                        today={today}
                        onEdit={(item) => openEditor({ mode: 'edit', task: item })}
                        onToggle={(item) => void run(toggle.mutateAsync(item))}
                        onAddSubtask={(item, title) =>
                          run(addSubtask.mutateAsync({ task: item, title }))
                        }
                        onMove={(item, direction) => {
                          const index = section.tasks.findIndex(
                            (candidate) => candidate.id === item.id,
                          );
                          const neighbour = section.tasks[index + direction];
                          if (neighbour)
                            void run(
                              move.mutateAsync({
                                task: item,
                                sectionId: section.id,
                                position: index + direction,
                              }),
                            );
                        }}
                        dragging={dragged?.kind === 'task' && dragged.task.id === task.id}
                        dropBefore={dragged?.kind === 'task' && dropTarget === task.id}
                        dragProps={{
                          draggable: true,
                          onDragStart: (event) =>
                            startDrag(event, { kind: 'task', task }, event.currentTarget),
                          onDragEnd: endDrag,
                          onDragOver: (event) => {
                            if (dragged?.kind === 'task') allowDrop(event, task.id);
                          },
                          onDrop: (event) => {
                            if (dragged?.kind !== 'task') return;
                            event.preventDefault();
                            event.stopPropagation();
                            placeTask(dragged.task, section, task);
                            endDrag();
                          },
                        }}
                      />
                    ))}
                    {visible.length === 0 && (
                      <p className="empty-inline">
                        {section.tasks.length ? 'No matching tasks.' : 'No tasks yet.'}
                      </p>
                    )}
                    <button
                      className="text-button add-task"
                      onClick={() => openEditor({ mode: 'create', sectionId: section.id })}
                    >
                      + Add task
                    </button>
                  </section>
                );
              })}
              <AddSection
                onAdd={(name) => run(addSection.mutateAsync({ projectId: project.id, name }))}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
