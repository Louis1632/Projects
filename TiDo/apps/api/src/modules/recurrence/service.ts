import { and, asc, eq, gt, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import type { RecurrenceScope, TaskPriority, TaskUpdateInput } from '@tido/contracts';
import { recurrenceExceptions, recurrenceSeries, taskLabels, tasks, type Executor } from '@tido/db';
import { badRequest } from '../../errors';
import { addDays, maxDay, minDay } from '../../lib/dates';
import type { AuthContext } from '../../types';
import {
  applyTaskPatch,
  assertAssignee,
  assertLabels,
  hasFields,
  setTaskLabels,
  type TaskRow,
} from '../tasks/core';
import {
  countBefore,
  firstOnOrAfter,
  normalizeRule,
  occurrencesBetween,
  ruleCount,
  validateRule,
  withEnd,
} from './rules';

/** Occurrences are kept generated at least this far ahead of today. */
export const HORIZON_DAYS = 90;
/** Calendar views may ask for generation up to this far ahead, but no further. */
export const MAX_HORIZON_DAYS = 730;
const INSERT_CHUNK = 400;

export type SeriesRow = typeof recurrenceSeries.$inferSelect;

export interface SeriesTemplate {
  projectId: string;
  sectionId: string;
  title: string;
  notes: string | null;
  priority: TaskPriority;
  assigneeId: string | null;
  labelIds: string[];
  subtaskTitles: string[];
}

type TemplatePatch = Partial<
  Pick<SeriesTemplate, 'title' | 'notes' | 'priority' | 'assigneeId' | 'labelIds'>
>;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    out.push(items.slice(index, index + size));
  return out;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/** Keeps only the template fields whose value differs from `current`. */
function changedTemplate(patch: TemplatePatch, current: Required<TemplatePatch>): TemplatePatch {
  const changed: TemplatePatch = {};
  if (patch.title !== undefined && patch.title !== current.title) changed.title = patch.title;
  if (patch.notes !== undefined && (patch.notes ?? null) !== current.notes)
    changed.notes = patch.notes;
  if (patch.priority !== undefined && patch.priority !== current.priority)
    changed.priority = patch.priority;
  if (patch.assigneeId !== undefined && (patch.assigneeId ?? null) !== current.assigneeId) {
    changed.assigneeId = patch.assigneeId;
  }
  if (patch.labelIds !== undefined && !sameSet(patch.labelIds, current.labelIds)) {
    changed.labelIds = patch.labelIds;
  }
  return changed;
}

async function lockSeries(exec: Executor, id: string): Promise<SeriesRow | undefined> {
  const [row] = await exec
    .select()
    .from(recurrenceSeries)
    .where(eq(recurrenceSeries.id, id))
    .for('update');
  return row;
}

async function insertOccurrences(
  exec: Executor,
  series: SeriesRow,
  dates: string[],
): Promise<void> {
  for (const batch of chunk(dates, INSERT_CHUNK)) {
    const created = await exec
      .insert(tasks)
      .values(
        batch.map((date) => ({
          workspaceId: series.workspaceId,
          projectId: series.projectId,
          sectionId: series.sectionId,
          recurrenceSeriesId: series.id,
          occurrenceDate: date,
          title: series.title,
          notes: series.notes,
          priority: series.priority,
          assigneeId: series.assigneeId,
          dueDate: date,
          createdBy: series.createdBy,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    const ids = created.map((row) => row.id);
    if (ids.length === 0) continue;

    if (series.subtaskTitles.length > 0) {
      const subtasks = ids.flatMap((parentTaskId) =>
        series.subtaskTitles.map((title, position) => ({
          workspaceId: series.workspaceId,
          projectId: series.projectId,
          sectionId: series.sectionId,
          parentTaskId,
          title,
          position,
          createdBy: series.createdBy,
        })),
      );
      for (const part of chunk(subtasks, INSERT_CHUNK)) await exec.insert(tasks).values(part);
    }
    if (series.labelIds.length > 0) await setTaskLabels(exec, ids, series.labelIds);
  }
}

/** Materialises every rule date after `generatedThrough` up to and including `through`. */
async function generateThrough(exec: Executor, series: SeriesRow, through: string): Promise<void> {
  if (!series.isActive) return;
  const from = maxDay(
    series.generatedThrough ? addDays(series.generatedThrough, 1) : series.startsOn,
    series.startsOn,
  );
  if (from > through) return;

  const exceptions = await exec
    .select({ date: recurrenceExceptions.occurrenceDate })
    .from(recurrenceExceptions)
    .where(
      and(
        eq(recurrenceExceptions.seriesId, series.id),
        gte(recurrenceExceptions.occurrenceDate, from),
        lte(recurrenceExceptions.occurrenceDate, through),
      ),
    );
  const excluded = new Set(exceptions.map((row) => row.date));
  const dates = occurrencesBetween(series.rrule, series.startsOn, from, through).filter(
    (date) => !excluded.has(date),
  );
  await insertOccurrences(exec, series, dates);
  await exec
    .update(recurrenceSeries)
    .set({ generatedThrough: through })
    .where(eq(recurrenceSeries.id, series.id));
  series.generatedThrough = through;
}

/**
 * Ensures every active series in the workspace has occurrences generated through `through`
 * (capped at MAX_HORIZON_DAYS from today). Safe to call concurrently.
 */
export async function ensureGenerated(
  exec: Executor,
  workspaceId: string,
  through: string,
  today: string,
): Promise<void> {
  const target = minDay(
    maxDay(through, addDays(today, HORIZON_DAYS)),
    addDays(today, MAX_HORIZON_DAYS),
  );
  const due = await exec
    .select({ id: recurrenceSeries.id })
    .from(recurrenceSeries)
    .where(
      and(
        eq(recurrenceSeries.workspaceId, workspaceId),
        eq(recurrenceSeries.isActive, true),
        sql`(${recurrenceSeries.generatedThrough} IS NULL OR ${recurrenceSeries.generatedThrough} < ${target})`,
      ),
    );
  for (const { id } of due) {
    await exec.transaction(async (tx) => {
      const series = await lockSeries(tx, id);
      if (series && (!series.generatedThrough || series.generatedThrough < target)) {
        await generateThrough(tx, series, target);
      }
    });
  }
}

/**
 * Creates a series and its first occurrence. When `existingTaskId` is given, that task
 * becomes the first occurrence instead of a new one being created.
 */
export async function startSeries(
  exec: Executor,
  auth: AuthContext,
  options: {
    template: SeriesTemplate;
    rrule: string;
    startsOn: string;
    today: string;
    existingTaskId?: string;
  },
): Promise<string> {
  const rrule = validateRule(options.rrule, options.startsOn);
  const first = firstOnOrAfter(rrule, options.startsOn, options.startsOn);
  if (!first) throw badRequest('That rule never produces a date.', 'invalid_rrule');
  await assertAssignee(exec, auth, options.template.assigneeId);
  await assertLabels(exec, auth, options.template.labelIds);

  const [series] = await exec
    .insert(recurrenceSeries)
    .values({
      ...options.template,
      workspaceId: auth.workspaceId,
      rrule,
      startsOn: options.startsOn,
      createdBy: auth.userId,
    })
    .returning();

  let taskId = options.existingTaskId;
  if (taskId) {
    await exec
      .update(tasks)
      .set({
        recurrenceSeriesId: series!.id,
        occurrenceDate: first,
        dueDate: first,
        startDate: sql`CASE WHEN ${tasks.startDate} > ${first} THEN NULL ELSE ${tasks.startDate} END`,
        isDetached: false,
      })
      .where(eq(tasks.id, taskId));
  } else {
    await insertOccurrences(exec, series!, [first]);
    const [row] = await exec
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.recurrenceSeriesId, series!.id), eq(tasks.occurrenceDate, first)));
    taskId = row!.id;
  }

  // Past dates between the first occurrence and today are not back-filled.
  series!.generatedThrough = maxDay(first, addDays(options.today, -1));
  await exec
    .update(recurrenceSeries)
    .set({ generatedThrough: series!.generatedThrough })
    .where(eq(recurrenceSeries.id, series!.id));
  await generateThrough(exec, series!, addDays(options.today, HORIZON_DAYS));
  return taskId;
}

const openGenerated = (seriesId: string) =>
  and(
    eq(tasks.recurrenceSeriesId, seriesId),
    isNull(tasks.parentTaskId),
    ne(tasks.status, 'done'),
    eq(tasks.isDetached, false),
    isNull(tasks.archivedAt),
  );

async function nextOpenOccurrence(exec: Executor, seriesId: string, excludeId: string) {
  const [row] = await exec
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.recurrenceSeriesId, seriesId),
        ne(tasks.status, 'done'),
        isNull(tasks.archivedAt),
        ne(tasks.id, excludeId),
      ),
    )
    .orderBy(asc(tasks.occurrenceDate))
    .limit(1);
  return row?.id;
}

/** Splits a series at `day`: the original ends the day before, a copy continues from `day`. */
async function splitSeries(
  exec: Executor,
  auth: AuthContext,
  series: SeriesRow,
  day: string,
): Promise<SeriesRow> {
  const before = countBefore(series.rrule, series.startsOn, day);
  const count = ruleCount(series.rrule);
  const continuingRule = count
    ? withEnd(series.rrule, { count: Math.max(count - before, 1) })
    : series.rrule;
  const dayBefore = addDays(day, -1);

  const { id: _id, createdAt: _c, updatedAt: _u, revision: _r, ...copy } = series;
  const [created] = await exec
    .insert(recurrenceSeries)
    .values({
      ...copy,
      rrule: continuingRule,
      startsOn: day,
      generatedThrough:
        series.generatedThrough && series.generatedThrough >= day
          ? series.generatedThrough
          : dayBefore,
      splitFromId: series.id,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    })
    .returning();

  await exec
    .update(recurrenceSeries)
    .set({
      rrule: withEnd(series.rrule, { until: dayBefore }),
      generatedThrough: minDay(series.generatedThrough ?? dayBefore, dayBefore),
      revision: series.revision + 1,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(recurrenceSeries.id, series.id));
  await exec
    .update(tasks)
    .set({ recurrenceSeriesId: created!.id })
    .where(and(eq(tasks.recurrenceSeriesId, series.id), gte(tasks.occurrenceDate, day)));
  await exec
    .update(recurrenceExceptions)
    .set({ seriesId: created!.id })
    .where(
      and(
        eq(recurrenceExceptions.seriesId, series.id),
        gte(recurrenceExceptions.occurrenceDate, day),
      ),
    );
  return created!;
}

/** Ends a series before `from` and removes its open, unedited occurrences from that day on. */
async function stopSeries(exec: Executor, series: SeriesRow, from: string, keepTaskId: string) {
  const hasEarlier = countBefore(series.rrule, series.startsOn, from) > 0;
  await exec
    .update(recurrenceSeries)
    .set({
      rrule: hasEarlier ? withEnd(series.rrule, { until: addDays(from, -1) }) : series.rrule,
      isActive: hasEarlier,
      updatedAt: new Date(),
    })
    .where(eq(recurrenceSeries.id, series.id));
  await exec
    .delete(tasks)
    .where(
      and(openGenerated(series.id), gte(tasks.occurrenceDate, from), ne(tasks.id, keepTaskId)),
    );
}

/** Applies template edits to a series and to every open occurrence that still follows it. */
async function applyTemplate(
  exec: Executor,
  auth: AuthContext,
  series: SeriesRow,
  patch: TemplatePatch,
) {
  await assertAssignee(exec, auth, patch.assigneeId);
  await assertLabels(exec, auth, patch.labelIds);
  const { labelIds, ...fields } = patch;
  await exec
    .update(recurrenceSeries)
    .set({
      ...fields,
      ...(labelIds ? { labelIds } : {}),
      revision: series.revision + 1,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(recurrenceSeries.id, series.id));

  const affected = (
    await exec.select({ id: tasks.id }).from(tasks).where(openGenerated(series.id))
  ).map((row) => row.id);
  if (affected.length === 0) return;
  if (hasFields(fields)) {
    await exec
      .update(tasks)
      .set({
        ...fields,
        revision: sql`${tasks.revision} + 1`,
        updatedBy: auth.userId,
        updatedAt: new Date(),
      })
      .where(inArray(tasks.id, affected));
  }
  if (labelIds) await setTaskLabels(exec, affected, labelIds);
}

async function currentLabelIds(exec: Executor, taskId: string): Promise<string[]> {
  const rows = await exec
    .select({ id: taskLabels.labelId })
    .from(taskLabels)
    .where(eq(taskLabels.taskId, taskId));
  return rows.map((row) => row.id);
}

async function reload(exec: Executor, id: string): Promise<TaskRow | undefined> {
  const [row] = await exec.select().from(tasks).where(eq(tasks.id, id));
  return row;
}

async function markOverridden(exec: Executor, auth: AuthContext, row: TaskRow) {
  await exec
    .insert(recurrenceExceptions)
    .values({
      seriesId: row.recurrenceSeriesId!,
      occurrenceDate: row.occurrenceDate!,
      kind: 'overridden',
      taskId: row.id,
      createdBy: auth.userId,
    })
    .onConflictDoUpdate({
      target: [recurrenceExceptions.seriesId, recurrenceExceptions.occurrenceDate],
      set: { kind: 'overridden', taskId: row.id },
    });
}

/**
 * Edits an occurrence of a recurring series in one of three scopes and returns the id of
 * the task the caller should show afterwards (the edited task, or the next occurrence if
 * a rule change removed it).
 */
export async function updateOccurrence(
  exec: Executor,
  auth: AuthContext,
  row: TaskRow,
  patch: TaskUpdateInput,
  today: string,
): Promise<string> {
  const scope: RecurrenceScope = patch.scope ?? 'occurrence';
  const series = await lockSeries(exec, row.recurrenceSeriesId!);
  const { title, notes, priority, assigneeId, labelIds, status, startDate, dueDate, recurrence } =
    patch;
  const template: TemplatePatch = { title, notes, priority, assigneeId, labelIds };
  const own = { status, startDate, dueDate };
  const datesChanged =
    (startDate !== undefined && startDate !== row.startDate) ||
    (dueDate !== undefined && dueDate !== row.dueDate);

  const rowLabels = await currentLabelIds(exec, row.id);
  const rowTemplate = changedTemplate(template, { ...row, labelIds: rowLabels });

  if (!series) {
    await applyTaskPatch(exec, auth, row, { ...rowTemplate, ...own });
    return row.id;
  }

  const stopping = recurrence === null;
  const ruleChanged =
    !!recurrence &&
    (normalizeRule(recurrence.rrule) !== series.rrule ||
      (recurrence.startsOn !== undefined && recurrence.startsOn !== series.startsOn));

  if (scope === 'occurrence') {
    if (stopping || ruleChanged) {
      throw badRequest(
        'Choose "this and future" or "all" to change how a task repeats.',
        'scope_required',
      );
    }
    const detach = hasFields(rowTemplate) || datesChanged;
    await applyTaskPatch(
      exec,
      auth,
      row,
      { ...rowTemplate, ...own },
      detach ? { isDetached: true } : {},
    );
    if (detach) await markOverridden(exec, auth, row);
    return row.id;
  }

  const day = row.occurrenceDate!;
  let target = series;
  let cutoff = today;
  if (scope === 'future') {
    if (countBefore(series.rrule, series.startsOn, day) > 0)
      target = await splitSeries(exec, auth, series, day);
    cutoff = day;
  }

  if (stopping) {
    await stopSeries(exec, target, cutoff, row.id);
    const current = (await reload(exec, row.id))!;
    await applyTaskPatch(
      exec,
      auth,
      current,
      { ...rowTemplate, ...own },
      {
        recurrenceSeriesId: null,
        occurrenceDate: null,
        isDetached: false,
      },
    );
    return row.id;
  }

  const seriesChanges = changedTemplate(template, target);
  if (hasFields(seriesChanges)) await applyTemplate(exec, auth, target, seriesChanges);

  // The edited occurrence always reflects the edit, even if it is completed or detached.
  let current = (await reload(exec, row.id))!;
  const remaining = changedTemplate(template, {
    ...current,
    labelIds: await currentLabelIds(exec, row.id),
  });
  if (hasFields(remaining) || hasFields(own)) {
    await applyTaskPatch(
      exec,
      auth,
      current,
      { ...remaining, ...own },
      datesChanged ? { isDetached: true } : {},
    );
    if (datesChanged) await markOverridden(exec, auth, current);
  }

  if (!ruleChanged) return row.id;

  const startsOn = recurrence!.startsOn ?? (scope === 'future' ? day : target.startsOn);
  const rrule = validateRule(recurrence!.rrule, startsOn);
  await exec
    .delete(tasks)
    .where(and(openGenerated(target.id), gte(tasks.occurrenceDate, cutoff), ne(tasks.id, row.id)));
  await exec
    .delete(recurrenceExceptions)
    .where(
      and(
        eq(recurrenceExceptions.seriesId, target.id),
        eq(recurrenceExceptions.kind, 'skipped'),
        gte(recurrenceExceptions.occurrenceDate, cutoff),
      ),
    );
  const [updated] = await exec
    .update(recurrenceSeries)
    .set({
      rrule,
      startsOn,
      generatedThrough: addDays(cutoff, -1),
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(recurrenceSeries.id, target.id))
    .returning();
  await generateThrough(exec, updated!, addDays(today, HORIZON_DAYS));

  // If the edited occurrence no longer falls on a rule date, hand over to the next one.
  current = (await reload(exec, row.id))!;
  if (current.status !== 'done' && !current.isDetached && current.occurrenceDate) {
    const fits =
      current.occurrenceDate >= startsOn &&
      occurrencesBetween(rrule, startsOn, current.occurrenceDate, current.occurrenceDate).length ===
        1;
    if (!fits) {
      const next = await nextOpenOccurrence(exec, target.id, row.id);
      if (next) {
        await exec.delete(tasks).where(eq(tasks.id, row.id));
        return next;
      }
      await exec.update(tasks).set({ isDetached: true }).where(eq(tasks.id, row.id));
    }
  }
  return row.id;
}

/** Deletes an occurrence (archiving it), this and future occurrences, or the whole series. */
export async function deleteOccurrence(
  exec: Executor,
  auth: AuthContext,
  row: TaskRow,
  scope: RecurrenceScope,
): Promise<void> {
  const series = row.recurrenceSeriesId
    ? await lockSeries(exec, row.recurrenceSeriesId)
    : undefined;
  if (series && scope === 'occurrence') {
    await exec
      .insert(recurrenceExceptions)
      .values({
        seriesId: series.id,
        occurrenceDate: row.occurrenceDate!,
        kind: 'skipped',
        taskId: row.id,
        createdBy: auth.userId,
      })
      .onConflictDoUpdate({
        target: [recurrenceExceptions.seriesId, recurrenceExceptions.occurrenceDate],
        set: { kind: 'skipped', taskId: row.id },
      });
  } else if (series && scope === 'future') {
    await stopSeries(exec, series, row.occurrenceDate!, row.id);
  } else if (series && scope === 'series') {
    await exec
      .update(recurrenceSeries)
      .set({ isActive: false, updatedBy: auth.userId, updatedAt: new Date() })
      .where(eq(recurrenceSeries.id, series.id));
    await exec
      .delete(tasks)
      .where(
        and(
          eq(tasks.recurrenceSeriesId, series.id),
          isNull(tasks.parentTaskId),
          ne(tasks.status, 'done'),
          isNull(tasks.archivedAt),
          ne(tasks.id, row.id),
        ),
      );
  }
  await exec
    .update(tasks)
    .set({
      archivedAt: new Date(),
      revision: row.revision + 1,
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, row.id));
}

/** Adds a subtask title to the series template and to later open occurrences. */
export async function addSubtaskToSeries(
  exec: Executor,
  auth: AuthContext,
  parent: TaskRow,
  title: string,
) {
  const series = await lockSeries(exec, parent.recurrenceSeriesId!);
  if (!series) return;
  const position = series.subtaskTitles.length;
  await exec
    .update(recurrenceSeries)
    .set({
      subtaskTitles: [...series.subtaskTitles, title],
      updatedBy: auth.userId,
      updatedAt: new Date(),
    })
    .where(eq(recurrenceSeries.id, series.id));
  const later = await exec
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(openGenerated(series.id), gt(tasks.occurrenceDate, parent.occurrenceDate!)));
  if (later.length === 0) return;
  for (const batch of chunk(later, INSERT_CHUNK)) {
    await exec.insert(tasks).values(
      batch.map(({ id }) => ({
        workspaceId: series.workspaceId,
        projectId: series.projectId,
        sectionId: series.sectionId,
        parentTaskId: id,
        title,
        position,
        createdBy: auth.userId,
      })),
    );
  }
}
