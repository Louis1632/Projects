import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Subtask, Task, TaskStatus, TaskUpdateInput } from '@tido/contracts';
import {
  labels,
  recurrenceSeries,
  taskCompletions,
  taskLabels,
  tasks,
  users,
  workspaceMembers,
  type Executor,
} from '@tido/db';
import { badRequest, notFound } from '../../errors';
import { iso } from '../../lib/dates';
import type { AuthContext } from '../../types';

export type TaskRow = typeof tasks.$inferSelect;

/** Loads labels, subtasks and recurrence details for task rows, preserving their order. */
export async function hydrateTasks(exec: Executor, rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];
  const topIds = rows.map((row) => row.id);
  const subtaskRows = await exec
    .select()
    .from(tasks)
    .where(and(inArray(tasks.parentTaskId, topIds), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));

  const allIds = [...topIds, ...subtaskRows.map((row) => row.id)];
  const labelRows = await exec
    .select({ taskId: taskLabels.taskId, id: labels.id, name: labels.name, color: labels.color })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(inArray(taskLabels.taskId, allIds))
    .orderBy(asc(labels.name));
  const labelsByTask = new Map<string, Task['labels']>();
  for (const { taskId, ...label } of labelRows) {
    labelsByTask.set(taskId, [...(labelsByTask.get(taskId) ?? []), label]);
  }

  const seriesIds = [
    ...new Set(rows.map((row) => row.recurrenceSeriesId).filter(Boolean)),
  ] as string[];
  const seriesRows = seriesIds.length
    ? await exec
        .select({
          id: recurrenceSeries.id,
          rrule: recurrenceSeries.rrule,
          startsOn: recurrenceSeries.startsOn,
        })
        .from(recurrenceSeries)
        .where(inArray(recurrenceSeries.id, seriesIds))
    : [];
  const seriesById = new Map(seriesRows.map((row) => [row.id, row]));

  const toBase = (row: TaskRow): Subtask => {
    const series = row.recurrenceSeriesId ? seriesById.get(row.recurrenceSeriesId) : undefined;
    return {
      id: row.id,
      projectId: row.projectId,
      sectionId: row.sectionId,
      parentTaskId: row.parentTaskId,
      title: row.title,
      notes: row.notes,
      status: row.status,
      priority: row.priority,
      assigneeId: row.assigneeId,
      startDate: row.startDate,
      dueDate: row.dueDate,
      position: row.position,
      revision: row.revision,
      completedAt: iso(row.completedAt),
      completedBy: row.completedBy,
      archivedAt: iso(row.archivedAt),
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      labels: labelsByTask.get(row.id) ?? [],
      recurrence: series
        ? {
            seriesId: series.id,
            rrule: series.rrule,
            startsOn: series.startsOn,
            occurrenceDate: row.occurrenceDate,
            detached: row.isDetached,
          }
        : null,
    };
  };

  const subtasksByParent = new Map<string, Subtask[]>();
  for (const row of subtaskRows) {
    const parentId = row.parentTaskId!;
    subtasksByParent.set(parentId, [...(subtasksByParent.get(parentId) ?? []), toBase(row)]);
  }
  return rows.map((row) => ({ ...toBase(row), subtasks: subtasksByParent.get(row.id) ?? [] }));
}

export async function getTaskRow(
  exec: Executor,
  auth: AuthContext,
  id: string,
  options: { forUpdate?: boolean } = {},
): Promise<TaskRow> {
  const query = exec
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.workspaceId, auth.workspaceId)));
  const [row] = options.forUpdate ? await query.for('update') : await query;
  if (!row) throw notFound('That task');
  return row;
}

export async function loadTask(exec: Executor, auth: AuthContext, id: string): Promise<Task> {
  const [task] = await hydrateTasks(exec, [await getTaskRow(exec, auth, id)]);
  return task!;
}

export async function assertAssignee(
  exec: Executor,
  auth: AuthContext,
  assigneeId: string | null | undefined,
) {
  if (!assigneeId) return;
  const [member] = await exec
    .select({ active: users.isActive })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, auth.workspaceId),
        eq(workspaceMembers.userId, assigneeId),
      ),
    );
  if (!member?.active)
    throw badRequest('Tasks can only be assigned to active members.', 'invalid_assignee');
}

export async function assertLabels(
  exec: Executor,
  auth: AuthContext,
  labelIds: string[] | undefined,
) {
  if (!labelIds?.length) return;
  const unique = [...new Set(labelIds)];
  const found = await exec
    .select({ id: labels.id })
    .from(labels)
    .where(and(eq(labels.workspaceId, auth.workspaceId), inArray(labels.id, unique)));
  if (found.length !== unique.length)
    throw badRequest('One or more labels do not exist.', 'invalid_label');
}

export async function setTaskLabels(exec: Executor, taskIds: string[], labelIds: string[]) {
  if (taskIds.length === 0) return;
  await exec.delete(taskLabels).where(inArray(taskLabels.taskId, taskIds));
  const unique = [...new Set(labelIds)];
  if (unique.length === 0) return;
  await exec
    .insert(taskLabels)
    .values(taskIds.flatMap((taskId) => unique.map((labelId) => ({ taskId, labelId }))))
    .onConflictDoNothing();
}

/** Column values that keep `status` and the completion stamp consistent. */
export function completionFields(status: TaskStatus, previous: TaskStatus | null, actorId: string) {
  if (status === 'done' && previous !== 'done') {
    return { status, completedAt: new Date(), completedBy: actorId };
  }
  if (status !== 'done' && previous === 'done') {
    return { status, completedAt: null, completedBy: null };
  }
  return { status };
}

export async function recordCompletionChange(
  exec: Executor,
  taskId: string,
  previous: TaskStatus,
  next: TaskStatus,
  actorId: string,
) {
  if ((previous === 'done') === (next === 'done')) return;
  await exec
    .insert(taskCompletions)
    .values({ taskId, action: next === 'done' ? 'completed' : 'reopened', actorId });
}

export type TaskFieldPatch = Pick<
  TaskUpdateInput,
  'title' | 'notes' | 'status' | 'priority' | 'assigneeId' | 'startDate' | 'dueDate' | 'labelIds'
>;

const definedKeys = <T extends object>(value: T) =>
  Object.keys(value).filter((key) => value[key as keyof T] !== undefined) as (keyof T)[];

export function hasFields(patch: object): boolean {
  return definedKeys(patch).length > 0;
}

/** Applies plain field edits to one task row, bumping its revision. */
export async function applyTaskPatch(
  exec: Executor,
  auth: AuthContext,
  row: TaskRow,
  patch: TaskFieldPatch,
  extra: Partial<typeof tasks.$inferInsert> = {},
): Promise<void> {
  await assertAssignee(exec, auth, patch.assigneeId);
  await assertLabels(exec, auth, patch.labelIds);

  const startDate = patch.startDate !== undefined ? patch.startDate : row.startDate;
  const dueDate = patch.dueDate !== undefined ? patch.dueDate : row.dueDate;
  if (startDate && dueDate && startDate > dueDate) {
    throw badRequest('The due date cannot be before the start date.', 'invalid_dates');
  }

  const { labelIds, status, ...fields } = patch;
  await exec
    .update(tasks)
    .set({
      ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
      ...(status ? completionFields(status, row.status, auth.userId) : {}),
      ...extra,
      revision: row.revision + 1,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, row.id));
  if (status) await recordCompletionChange(exec, row.id, row.status, status, auth.userId);
  if (labelIds) await setTaskLabels(exec, [row.id], labelIds);
}

/**
 * Top-level tasks as the list view shows them: plain tasks plus, for each recurring
 * series, only its earliest open occurrence (so a daily chore does not flood the list).
 */
export function listedTaskCondition(exec: Executor, workspaceId: string) {
  const nextOccurrences = exec
    .selectDistinctOn([tasks.recurrenceSeriesId], { id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        isNull(tasks.parentTaskId),
        isNull(tasks.archivedAt),
        sql`${tasks.recurrenceSeriesId} IS NOT NULL`,
        sql`${tasks.status} <> 'done'`,
      ),
    )
    .orderBy(tasks.recurrenceSeriesId, asc(tasks.occurrenceDate));
  return and(
    eq(tasks.workspaceId, workspaceId),
    isNull(tasks.parentTaskId),
    isNull(tasks.archivedAt),
    or(isNull(tasks.recurrenceSeriesId), inArray(tasks.id, nextOccurrences)),
  );
}

/** The single ordering used for tasks within a section, matching the list view. */
export const sectionOrder = [
  asc(tasks.position),
  sql`${tasks.dueDate} ASC NULLS LAST`,
  asc(tasks.createdAt),
];
