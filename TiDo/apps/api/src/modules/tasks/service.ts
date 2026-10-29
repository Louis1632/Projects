import {
  and,
  asc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  RecurrenceScope,
  Task,
  TaskCreateInput,
  TaskFilter,
  TaskMoveInput,
  TaskUpdateInput,
} from '@tido/contracts';
import { taskCompletions, taskLabels, tasks, users, type Executor } from '@tido/db';
import { badRequest, staleRevision } from '../../errors';
import { iso } from '../../lib/dates';
import { changedPositions, placeAt } from '../../lib/ordering';
import type { AuthContext } from '../../types';
import { getSection } from '../projects/routes';
import {
  addSubtaskToSeries,
  deleteOccurrence,
  startSeries,
  updateOccurrence,
} from '../recurrence/service';
import {
  applyTaskPatch,
  assertAssignee,
  assertLabels,
  completionFields,
  getTaskRow,
  hydrateTasks,
  listedTaskCondition,
  loadTask,
  recordCompletionChange,
  sectionOrder,
  setTaskLabels,
  type TaskRow,
} from './core';

async function nextPosition(exec: Executor, sectionId: string, parentTaskId: string | null) {
  const [row] = await exec
    .select({ next: sql<number>`coalesce(max(${tasks.position}) + 1, 0)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.sectionId, sectionId),
        parentTaskId ? eq(tasks.parentTaskId, parentTaskId) : isNull(tasks.parentTaskId),
      ),
    );
  return row?.next ?? 0;
}

export async function createTask(
  exec: Executor,
  auth: AuthContext,
  input: TaskCreateInput,
  today: string,
): Promise<Task> {
  return exec.transaction(async (tx) => {
    await assertAssignee(tx, auth, input.assigneeId);
    await assertLabels(tx, auth, input.labelIds);

    let parent: TaskRow | undefined;
    if (input.parentTaskId) {
      parent = await getTaskRow(tx, auth, input.parentTaskId, { forUpdate: true });
      if (parent.parentTaskId)
        throw badRequest('Subtasks cannot have their own subtasks.', 'subtask_depth');
    }
    const section = await getSection(tx, auth, parent?.sectionId ?? input.sectionId);
    if (section.archivedAt) throw badRequest('That section is archived.', 'section_archived');

    if (input.recurrence && !parent) {
      const id = await startSeries(tx, auth, {
        template: {
          projectId: section.projectId,
          sectionId: section.id,
          title: input.title,
          notes: input.notes ?? null,
          priority: input.priority ?? 'medium',
          assigneeId: input.assigneeId ?? null,
          labelIds: input.labelIds ?? [],
          subtaskTitles: [],
        },
        rrule: input.recurrence.rrule,
        startsOn: input.recurrence.startsOn ?? input.dueDate ?? today,
        today,
      });
      return loadTask(tx, auth, id);
    }

    const status = input.status ?? 'todo';
    const [created] = await tx
      .insert(tasks)
      .values({
        workspaceId: auth.workspaceId,
        projectId: section.projectId,
        sectionId: section.id,
        parentTaskId: parent?.id ?? null,
        title: input.title,
        notes: input.notes ?? null,
        priority: input.priority ?? 'medium',
        assigneeId: input.assigneeId ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        position: await nextPosition(tx, section.id, parent?.id ?? null),
        createdBy: auth.userId,
        ...completionFields(status, null, auth.userId),
      })
      .returning();
    if (status === 'done')
      await recordCompletionChange(tx, created!.id, 'todo', 'done', auth.userId);
    if (input.labelIds?.length) await setTaskLabels(tx, [created!.id], input.labelIds);
    if (parent?.recurrenceSeriesId && input.repeatSubtask) {
      await addSubtaskToSeries(tx, auth, parent, input.title);
    }
    return loadTask(tx, auth, created!.id);
  });
}

export async function updateTask(
  exec: Executor,
  auth: AuthContext,
  id: string,
  patch: TaskUpdateInput,
  today: string,
): Promise<Task> {
  return exec.transaction(async (tx) => {
    const row = await getTaskRow(tx, auth, id, { forUpdate: true });
    if (row.revision !== patch.revision) throw staleRevision();
    const { revision: _revision, scope: _scope, recurrence, ...fields } = patch;

    if (row.recurrenceSeriesId && !row.parentTaskId) {
      return loadTask(tx, auth, await updateOccurrence(tx, auth, row, patch, today));
    }
    if (row.parentTaskId && recurrence) {
      throw badRequest('A subtask repeats with its parent task.', 'subtask_recurrence');
    }

    await applyTaskPatch(tx, auth, row, fields);
    if (recurrence) {
      const current = await getTaskRow(tx, auth, id);
      const subtasks = await tx
        .select({ title: tasks.title })
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, id), isNull(tasks.archivedAt)))
        .orderBy(asc(tasks.position));
      const labelRows = await tx
        .select({ id: taskLabels.labelId })
        .from(taskLabels)
        .where(eq(taskLabels.taskId, id));
      await startSeries(tx, auth, {
        template: {
          projectId: current.projectId,
          sectionId: current.sectionId,
          title: current.title,
          notes: current.notes,
          priority: current.priority,
          assigneeId: current.assigneeId,
          labelIds: labelRows.map((label) => label.id),
          subtaskTitles: subtasks.map((subtask) => subtask.title),
        },
        rrule: recurrence.rrule,
        startsOn: recurrence.startsOn ?? current.dueDate ?? today,
        today,
        existingTaskId: id,
      });
    }
    return loadTask(tx, auth, id);
  });
}

export async function setCompletion(
  exec: Executor,
  auth: AuthContext,
  id: string,
  completed: boolean,
) {
  return exec.transaction(async (tx) => {
    const row = await getTaskRow(tx, auth, id, { forUpdate: true });
    const status = completed ? 'done' : row.status === 'done' ? 'todo' : row.status;
    if (status !== row.status) {
      await tx
        .update(tasks)
        .set({
          ...completionFields(status, row.status, auth.userId),
          revision: row.revision + 1,
          updatedBy: auth.userId,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id));
      await recordCompletionChange(tx, id, row.status, status, auth.userId);
    }
    return loadTask(tx, auth, id);
  });
}

export async function moveTask(
  exec: Executor,
  auth: AuthContext,
  id: string,
  input: TaskMoveInput,
) {
  return exec.transaction(async (tx) => {
    const row = await getTaskRow(tx, auth, id, { forUpdate: true });
    if (row.revision !== input.revision) throw staleRevision();
    if (row.parentTaskId && input.sectionId !== row.sectionId) {
      throw badRequest('Subtasks move with their parent task.', 'subtask_move');
    }
    const section = await getSection(tx, auth, input.sectionId);
    if (section.archivedAt) throw badRequest('That section is archived.', 'section_archived');

    // Siblings are ordered exactly as the list view shows them, so `position` is the
    // index the person sees.
    const siblings = await tx
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .where(
        and(
          eq(tasks.sectionId, section.id),
          row.parentTaskId
            ? and(eq(tasks.parentTaskId, row.parentTaskId), isNull(tasks.archivedAt))
            : listedTaskCondition(tx, auth.workspaceId),
          ne(tasks.id, row.id),
        ),
      )
      .orderBy(...sectionOrder);
    const order = placeAt(
      siblings.map((sibling) => sibling.id),
      row.id,
      input.position,
    );
    for (const change of changedPositions(siblings, order)) {
      if (change.id !== row.id) {
        await tx.update(tasks).set({ position: change.position }).where(eq(tasks.id, change.id));
      }
    }
    await tx
      .update(tasks)
      .set({
        sectionId: section.id,
        projectId: section.projectId,
        position: order.indexOf(row.id),
        revision: row.revision + 1,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, row.id));
    if (!row.parentTaskId && section.id !== row.sectionId) {
      await tx
        .update(tasks)
        .set({ sectionId: section.id, projectId: section.projectId })
        .where(eq(tasks.parentTaskId, row.id));
    }
    return loadTask(tx, auth, id);
  });
}

export async function deleteTask(
  exec: Executor,
  auth: AuthContext,
  id: string,
  scope: RecurrenceScope,
) {
  await exec.transaction(async (tx) => {
    const row = await getTaskRow(tx, auth, id, { forUpdate: true });
    if (row.recurrenceSeriesId && !row.parentTaskId) {
      await deleteOccurrence(tx, auth, row, scope);
      return;
    }
    await tx
      .update(tasks)
      .set({
        archivedAt: new Date(),
        revision: row.revision + 1,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, id));
  });
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

export async function listTasks(
  exec: Executor,
  auth: AuthContext,
  filter: TaskFilter,
): Promise<Task[]> {
  const subtask = alias(tasks, 'subtask');
  const conditions: (SQL | undefined)[] = [
    eq(tasks.workspaceId, auth.workspaceId),
    isNull(tasks.parentTaskId),
    filter.includeArchived ? undefined : isNull(tasks.archivedAt),
    filter.projectId ? eq(tasks.projectId, filter.projectId) : undefined,
    filter.sectionId ? eq(tasks.sectionId, filter.sectionId) : undefined,
    filter.assigneeId === 'none'
      ? isNull(tasks.assigneeId)
      : filter.assigneeId
        ? eq(tasks.assigneeId, filter.assigneeId)
        : undefined,
    filter.status ? inArray(tasks.status, filter.status) : undefined,
    filter.priority ? inArray(tasks.priority, filter.priority) : undefined,
    filter.dueFrom ? gte(tasks.dueDate, filter.dueFrom) : undefined,
    filter.dueTo ? lte(tasks.dueDate, filter.dueTo) : undefined,
    filter.labelId
      ? exists(
          exec
            .select({ one: sql`1` })
            .from(taskLabels)
            .where(and(eq(taskLabels.taskId, tasks.id), eq(taskLabels.labelId, filter.labelId))),
        )
      : undefined,
  ];
  if (filter.query) {
    const pattern = `%${escapeLike(filter.query)}%`;
    conditions.push(
      or(
        ilike(tasks.title, pattern),
        ilike(tasks.notes, pattern),
        exists(
          exec
            .select({ one: sql`1` })
            .from(subtask)
            .where(and(eq(subtask.parentTaskId, tasks.id), ilike(subtask.title, pattern))),
        ),
      ),
    );
  }
  const rows = await exec
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(sql`${tasks.dueDate} ASC NULLS LAST`, asc(tasks.position), asc(tasks.createdAt))
    .limit(filter.limit);
  return hydrateTasks(exec, rows);
}

export async function listCompletions(exec: Executor, auth: AuthContext, id: string) {
  await getTaskRow(exec, auth, id);
  const rows = await exec
    .select({
      action: taskCompletions.action,
      occurredAt: taskCompletions.occurredAt,
      actorId: taskCompletions.actorId,
      actorName: users.displayName,
    })
    .from(taskCompletions)
    .leftJoin(users, eq(users.id, taskCompletions.actorId))
    .where(eq(taskCompletions.taskId, id))
    .orderBy(asc(taskCompletions.occurredAt));
  return rows.map((row) => ({ ...row, occurredAt: iso(row.occurredAt) }));
}
