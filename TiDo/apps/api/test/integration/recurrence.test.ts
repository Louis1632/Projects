import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recurrenceSeries } from '@tido/db';
import { addDays } from '../../src/lib/dates';
import {
  createList,
  createTestApp,
  resetDatabase,
  setupOwner,
  type Client,
  type TestContext,
} from './helpers';

let context: TestContext;
let owner: Client;
let sectionId: string;
let today: string;

interface TaskBody {
  id: string;
  title: string;
  dueDate: string | null;
  status: string;
  revision: number;
  subtasks: { title: string }[];
  recurrence: { seriesId: string; rrule: string; occurrenceDate: string; detached: boolean } | null;
}

beforeAll(async () => {
  context = await createTestApp();
  today = context.today;
});
afterAll(async () => {
  await context.close();
});
beforeEach(async () => {
  await resetDatabase(context.db);
  ({ owner } = await setupOwner(context));
  ({ sectionId } = await createList(owner));
});

async function createRecurring(
  rrule: string,
  title = 'Feed cat',
  extra: Record<string, unknown> = {},
) {
  const response = await owner.post<TaskBody>('/tasks', {
    sectionId,
    title,
    dueDate: today,
    recurrence: { rrule },
    ...extra,
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function calendar(from: string, to: string): Promise<TaskBody[]> {
  const response = await owner.get<TaskBody[]>(`/calendar?from=${from}&to=${to}`);
  expect(response.status).toBe(200);
  return response.body;
}

const week = () => calendar(today, addDays(today, 6));
const on = (tasks: TaskBody[], day: string) => tasks.find((task) => task.dueDate === day)!;
const weekdayCode = (day: string) =>
  ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${day}T00:00:00Z`).getUTCDay()]!;

describe('recurring series', () => {
  it('creates the first occurrence and generates a bounded horizon', async () => {
    const first = await createRecurring('FREQ=DAILY');
    expect(first.dueDate).toBe(today);
    expect(first.recurrence).toMatchObject({
      rrule: 'FREQ=DAILY',
      occurrenceDate: today,
      detached: false,
    });

    expect(await week()).toHaveLength(7);
    // The list shows only the next open occurrence of each series.
    const dashboard = await owner.get('/dashboard');
    expect(dashboard.body.projects[0].sections[0].tasks).toHaveLength(1);

    const [series] = await context.db.select().from(recurrenceSeries);
    expect(series!.generatedThrough).toBe(addDays(today, 90));
  });

  it('extends generation on demand when the calendar looks further ahead', async () => {
    await createRecurring('FREQ=WEEKLY');
    const far = addDays(today, 200);
    const tasks = await calendar(addDays(far, -6), far);
    expect(tasks).toHaveLength(1);
  });

  it('respects COUNT', async () => {
    await createRecurring('FREQ=DAILY;COUNT=3');
    expect(await calendar(today, addDays(today, 30))).toHaveLength(3);
  });

  it('rejects invalid rules with a helpful message', async () => {
    const response = await owner.post('/tasks', {
      sectionId,
      title: 'x',
      recurrence: { rrule: 'FREQ=DAILY;BYHOUR=8' },
    });
    expect(response.status).toBe(400);
  });

  it('shows the next occurrence once the current one is completed', async () => {
    const first = await createRecurring('FREQ=DAILY');
    await owner.post(`/tasks/${first.id}/completion`, { completed: true });
    const dashboard = await owner.get('/dashboard');
    const [listed] = dashboard.body.projects[0].sections[0].tasks;
    expect(listed.dueDate).toBe(addDays(today, 1));
  });

  it('clones direct subtasks into occurrences', async () => {
    const first = await createRecurring('FREQ=DAILY');
    await owner.post('/tasks', {
      sectionId,
      parentTaskId: first.id,
      title: 'Fresh water',
      repeatSubtask: true,
    });
    await owner.post('/tasks', { sectionId, parentTaskId: first.id, title: 'Only today' });
    const tasks = await week();
    expect(on(tasks, today).subtasks.map((s) => s.title)).toEqual(['Fresh water', 'Only today']);
    expect(on(tasks, addDays(today, 3)).subtasks.map((s) => s.title)).toEqual(['Fresh water']);
  });

  it('turns an existing task into a recurring one', async () => {
    const plain = await owner.post<TaskBody>('/tasks', {
      sectionId,
      title: 'Bins',
      dueDate: today,
    });
    const updated = await owner.patch<TaskBody>(`/tasks/${plain.body.id}`, {
      revision: plain.body.revision,
      recurrence: { rrule: 'FREQ=DAILY' },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.id).toBe(plain.body.id);
    expect(updated.body.recurrence?.occurrenceDate).toBe(today);
    expect(await week()).toHaveLength(7);
  });
});

describe('editing occurrences', () => {
  it('edits a single occurrence without touching the rest', async () => {
    await createRecurring('FREQ=DAILY');
    const target = on(await week(), addDays(today, 2));
    const edited = await owner.patch<TaskBody>(`/tasks/${target.id}`, {
      revision: target.revision,
      title: 'Feed cat (vet visit)',
      scope: 'occurrence',
    });
    expect(edited.body.recurrence?.detached).toBe(true);

    // A later series-wide edit leaves the individually edited occurrence alone.
    const first = on(await week(), today);
    await owner.patch(`/tasks/${first.id}`, {
      revision: first.revision,
      title: 'Feed both cats',
      scope: 'series',
    });
    const titles = (await week()).map((task) => task.title);
    expect(titles.filter((title) => title === 'Feed cat (vet visit)')).toHaveLength(1);
    expect(titles.filter((title) => title === 'Feed both cats')).toHaveLength(6);
  });

  it('series edits never rewrite completed occurrences', async () => {
    await createRecurring('FREQ=DAILY');
    const first = on(await week(), today);
    await owner.post(`/tasks/${first.id}/completion`, { completed: true });
    const second = on(await week(), addDays(today, 1));
    await owner.patch(`/tasks/${second.id}`, {
      revision: second.revision,
      title: 'Renamed',
      scope: 'series',
    });
    const tasks = await week();
    expect(on(tasks, today).title).toBe('Feed cat');
    expect(on(tasks, addDays(today, 4)).title).toBe('Renamed');
  });

  it('allows editing a completed occurrence on its own', async () => {
    const first = await createRecurring('FREQ=DAILY');
    const done = await owner.post<TaskBody>(`/tasks/${first.id}/completion`, { completed: true });
    const edited = await owner.patch<TaskBody>(`/tasks/${first.id}`, {
      revision: done.body.revision,
      notes: 'Used the new food',
      scope: 'occurrence',
    });
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('done');
  });

  it('"this and future" splits the series', async () => {
    await createRecurring('FREQ=DAILY');
    const splitDay = addDays(today, 3);
    const target = on(await week(), splitDay);
    await owner.patch(`/tasks/${target.id}`, {
      revision: target.revision,
      title: 'Feed cat (new food)',
      scope: 'future',
    });

    const tasks = await week();
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays(today, offset);
      expect(on(tasks, day).title).toBe(offset < 3 ? 'Feed cat' : 'Feed cat (new food)');
    }
    const series = await context.db
      .select()
      .from(recurrenceSeries)
      .orderBy(recurrenceSeries.createdAt);
    expect(series).toHaveLength(2);
    expect(series[0]!.rrule).toBe(`FREQ=DAILY;UNTIL=${addDays(splitDay, -1).replaceAll('-', '')}`);
    expect(series[1]).toMatchObject({ startsOn: splitDay, splitFromId: series[0]!.id });
  });

  it('"this and future" on the first occurrence edits the whole series', async () => {
    const first = await createRecurring('FREQ=DAILY;COUNT=5');
    await owner.patch(`/tasks/${first.id}`, {
      revision: first.revision,
      title: 'All',
      scope: 'future',
    });
    expect(await context.db.select().from(recurrenceSeries)).toHaveLength(1);
    expect((await week()).every((task) => task.title === 'All')).toBe(true);
  });

  it('keeps COUNT totals across a split', async () => {
    await createRecurring('FREQ=DAILY;COUNT=5');
    const target = on(await week(), addDays(today, 2));
    await owner.patch(`/tasks/${target.id}`, {
      revision: target.revision,
      title: 'Tail',
      scope: 'future',
    });
    const tasks = await calendar(today, addDays(today, 30));
    expect(tasks).toHaveLength(5);
    expect(tasks.filter((task) => task.title === 'Tail')).toHaveLength(3);
  });

  it('changing the rule regenerates future occurrences', async () => {
    const first = await createRecurring('FREQ=DAILY');
    const nextDay = weekdayCode(addDays(today, 1));
    const updated = await owner.patch<TaskBody>(`/tasks/${first.id}`, {
      revision: first.revision,
      recurrence: { rrule: `FREQ=WEEKLY;BYDAY=${nextDay}` },
      scope: 'series',
    });
    expect(updated.status).toBe(200);
    const tasks = await calendar(today, addDays(today, 13));
    expect(tasks.map((task) => task.dueDate)).toEqual([addDays(today, 1), addDays(today, 8)]);
    // The edited task no longer matched the rule, so the next occurrence is returned instead.
    expect(updated.body.dueDate).toBe(addDays(today, 1));
  });

  it('requires a wider scope to change the rule', async () => {
    const first = await createRecurring('FREQ=DAILY');
    const response = await owner.patch(`/tasks/${first.id}`, {
      revision: first.revision,
      recurrence: { rrule: 'FREQ=WEEKLY' },
      scope: 'occurrence',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('scope_required');
  });

  it('stops repeating while keeping the edited task', async () => {
    const first = await createRecurring('FREQ=DAILY');
    const stopped = await owner.patch<TaskBody>(`/tasks/${first.id}`, {
      revision: first.revision,
      recurrence: null,
      scope: 'series',
    });
    expect(stopped.body.recurrence).toBeNull();
    expect((await week()).map((task) => task.id)).toEqual([first.id]);
  });
});

describe('deleting occurrences', () => {
  it('skips one occurrence and never regenerates it', async () => {
    await createRecurring('FREQ=DAILY');
    const skipped = on(await week(), addDays(today, 2));
    expect((await owner.delete(`/tasks/${skipped.id}?scope=occurrence`)).status).toBe(200);
    expect(on(await week(), addDays(today, 2))).toBeUndefined();

    // Force regeneration over the skipped date.
    await context.db
      .update(recurrenceSeries)
      .set({ generatedThrough: sql`${addDays(today, 1)}::date` });
    expect(on(await week(), addDays(today, 2))).toBeUndefined();
    expect(await week()).toHaveLength(6);
  });

  it('deletes this and following occurrences', async () => {
    await createRecurring('FREQ=DAILY');
    const target = on(await week(), addDays(today, 4));
    await owner.delete(`/tasks/${target.id}?scope=future`);
    expect((await calendar(today, addDays(today, 30))).map((task) => task.dueDate)).toEqual(
      [0, 1, 2, 3].map((offset) => addDays(today, offset)),
    );
  });

  it('deletes the whole series but keeps completed history', async () => {
    const first = await createRecurring('FREQ=DAILY');
    await owner.post(`/tasks/${first.id}/completion`, { completed: true });
    const second = on(await week(), addDays(today, 1));
    await owner.delete(`/tasks/${second.id}?scope=series`);
    const tasks = await calendar(today, addDays(today, 30));
    expect(tasks.map((task) => task.id)).toEqual([first.id]);
    const [series] = await context.db
      .select()
      .from(recurrenceSeries)
      .where(eq(recurrenceSeries.id, first.recurrence!.seriesId));
    expect(series!.isActive).toBe(false);
  });
});
