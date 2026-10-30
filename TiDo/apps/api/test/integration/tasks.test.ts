import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays } from '../../src/lib/dates';
import {
  addMember,
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
let projectId: string;

beforeAll(async () => {
  context = await createTestApp();
});
afterAll(async () => {
  await context.close();
});
beforeEach(async () => {
  await resetDatabase(context.db);
  ({ owner } = await setupOwner(context));
  ({ projectId, sectionId } = await createList(owner));
});

const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title);

describe('lists and sections', () => {
  it('creates a default section with every new list and orders sections', async () => {
    const dashboard = await owner.get('/dashboard');
    expect(dashboard.body.projects[0].sections.map((s: { name: string }) => s.name)).toEqual([
      'Tasks',
    ]);
    const extra = await owner.post(`/projects/${projectId}/sections`, { name: 'Later' });
    expect(extra.body.position).toBe(1);
    const moved = await owner.patch(`/sections/${extra.body.id}`, {
      position: 0,
      revision: extra.body.revision,
    });
    expect(moved.body.position).toBe(0);
    const after = await owner.get('/dashboard');
    expect(after.body.projects[0].sections.map((s: { name: string }) => s.name)).toEqual([
      'Later',
      'Tasks',
    ]);
  });
});

describe('tasks', () => {
  it('creates, updates and completes a task with attribution', async () => {
    const created = await owner.post('/tasks', {
      sectionId,
      title: 'Water plants',
      priority: 'high',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      title: 'Water plants',
      status: 'todo',
      priority: 'high',
      revision: 1,
    });

    const done = await owner.post(`/tasks/${created.body.id}/completion`, { completed: true });
    expect(done.body.status).toBe('done');
    expect(done.body.completedBy).toBe(created.body.createdBy);
    await owner.post(`/tasks/${created.body.id}/completion`, { completed: false });
    const history = await owner.get(`/tasks/${created.body.id}/completions`);
    expect(history.body.map((entry: { action: string }) => entry.action)).toEqual([
      'completed',
      'reopened',
    ]);
  });

  it('lets every member co-edit and records who changed what', async () => {
    const { client: member, user } = await addMember(context, owner, 'sam@example.test');
    const created = await owner.post('/tasks', { sectionId, title: 'Shared' });
    const edited = await member.patch(`/tasks/${created.body.id}`, {
      title: 'Shared, edited',
      revision: 1,
    });
    expect(edited.status).toBe(200);
    expect(edited.body.updatedBy).toBe(user.id);
  });

  it('detects concurrent edits with revisions', async () => {
    const created = await owner.post('/tasks', { sectionId, title: 'Original' });
    expect(
      (await owner.patch(`/tasks/${created.body.id}`, { title: 'First', revision: 1 })).status,
    ).toBe(200);
    const stale = await owner.patch(`/tasks/${created.body.id}`, { title: 'Second', revision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('stale_revision');
  });

  it('rejects due dates before start dates', async () => {
    const response = await owner.post('/tasks', {
      sectionId,
      title: 'x',
      startDate: '2026-05-02',
      dueDate: '2026-05-01',
    });
    expect(response.status).toBe(400);
  });

  it('assigns only active members', async () => {
    const { user } = await addMember(context, owner, 'sam@example.test');
    const created = await owner.post('/tasks', { sectionId, title: 'Bins', assigneeId: user.id });
    expect(created.body.assigneeId).toBe(user.id);
    await owner.post(`/members/${user.id}/deactivate`);
    const rejected = await owner.post('/tasks', {
      sectionId,
      title: 'More bins',
      assigneeId: user.id,
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('invalid_assignee');
  });

  it('archives instead of deleting', async () => {
    const created = await owner.post('/tasks', { sectionId, title: 'Old' });
    await owner.delete(`/tasks/${created.body.id}`);
    const dashboard = await owner.get('/dashboard');
    expect(dashboard.body.projects[0].sections[0].tasks).toHaveLength(0);
    const archived = await owner.get(`/tasks?includeArchived=true`);
    expect(archived.body[0].archivedAt).not.toBeNull();
  });
});

describe('subtasks', () => {
  it('supports exactly one level of subtasks', async () => {
    const parent = await owner.post('/tasks', { sectionId, title: 'Parent' });
    const child = await owner.post('/tasks', {
      sectionId,
      parentTaskId: parent.body.id,
      title: 'Child',
    });
    expect(child.status).toBe(201);
    expect(child.body.parentTaskId).toBe(parent.body.id);

    const grandchild = await owner.post('/tasks', {
      sectionId,
      parentTaskId: child.body.id,
      title: 'Too deep',
    });
    expect(grandchild.status).toBe(400);
    expect(grandchild.body.error.code).toBe('subtask_depth');

    const loaded = await owner.get(`/tasks/${parent.body.id}`);
    expect(titles(loaded.body.subtasks)).toEqual(['Child']);
  });

  it('enforces the depth rule in the database as well', async () => {
    const parent = await owner.post('/tasks', { sectionId, title: 'Parent' });
    const child = await owner.post('/tasks', {
      sectionId,
      parentTaskId: parent.body.id,
      title: 'Child',
    });
    await expect(
      context.db.execute(
        sql`UPDATE tasks SET parent_task_id = ${child.body.id} WHERE id = ${parent.body.id}`,
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/subtask/) } });
  });

  it('completes subtasks independently of the parent', async () => {
    const parent = await owner.post('/tasks', { sectionId, title: 'Parent' });
    const child = await owner.post('/tasks', {
      sectionId,
      parentTaskId: parent.body.id,
      title: 'Child',
    });
    await owner.post(`/tasks/${child.body.id}/completion`, { completed: true });
    const loaded = await owner.get(`/tasks/${parent.body.id}`);
    expect(loaded.body.status).toBe('todo');
    expect(loaded.body.subtasks[0].status).toBe('done');
  });

  it('archives a task from the list once it and all its subtasks are done', async () => {
    const listed = async () =>
      titles((await owner.get('/dashboard')).body.projects[0].sections[0].tasks);
    const single = await owner.post('/tasks', { sectionId, title: 'Single' });
    const parent = await owner.post('/tasks', { sectionId, title: 'Parent' });
    const child = await owner.post('/tasks', {
      sectionId,
      parentTaskId: parent.body.id,
      title: 'Child',
    });

    await owner.post(`/tasks/${single.body.id}/completion`, { completed: true });
    expect(await listed()).toEqual(['Parent']);

    // Done with a subtask still open: it stays, until that subtask is ticked too.
    await owner.post(`/tasks/${parent.body.id}/completion`, { completed: true });
    expect(await listed()).toEqual(['Parent']);
    await owner.post(`/tasks/${child.body.id}/completion`, { completed: true });
    expect(await listed()).toEqual([]);

    // Archived tasks keep their place in search, and reopening brings them back.
    expect(titles((await owner.get('/tasks?status=done')).body)).toEqual(['Single', 'Parent']);
    await owner.post(`/tasks/${child.body.id}/completion`, { completed: false });
    await owner.post(`/tasks/${single.body.id}/completion`, { completed: false });
    expect(await listed()).toEqual(['Single', 'Parent']);
  });
});

describe('ordering', () => {
  it('reorders tasks within a section and moves them between sections', async () => {
    for (const title of ['A', 'B', 'C']) await owner.post('/tasks', { sectionId, title });
    const listed = async (id: string) =>
      titles(
        (await owner.get('/dashboard')).body.projects[0].sections.find(
          (s: { id: string }) => s.id === id,
        ).tasks,
      );
    expect(await listed(sectionId)).toEqual(['A', 'B', 'C']);

    const c = (await owner.get('/tasks?query=C')).body[0];
    await owner.post(`/tasks/${c.id}/move`, { sectionId, position: 0, revision: c.revision });
    expect(await listed(sectionId)).toEqual(['C', 'A', 'B']);

    const other = await owner.post(`/projects/${projectId}/sections`, { name: 'Other' });
    const a = (await owner.get('/tasks?query=A')).body[0];
    await owner.post('/tasks', { sectionId, parentTaskId: a.id, title: 'A child' });
    await owner.post(`/tasks/${a.id}/move`, {
      sectionId: other.body.id,
      position: 0,
      revision: a.revision,
    });
    expect(await listed(sectionId)).toEqual(['C', 'B']);
    expect(await listed(other.body.id)).toEqual(['A']);
    const moved = await owner.get(`/tasks/${a.id}`);
    expect(moved.body.subtasks[0].sectionId).toBe(other.body.id);
  });
});

describe('search and filters', () => {
  it('filters by status, assignee, label, priority, dates and text', async () => {
    const { user: sam } = await addMember(context, owner, 'sam@example.test');
    const label = await owner.post('/labels', { name: 'Garden', color: '#2f855a' });
    const today = context.today;
    const a = await owner.post('/tasks', {
      sectionId,
      title: 'Mow lawn',
      assigneeId: sam.id,
      labelIds: [label.body.id],
      dueDate: today,
      priority: 'high',
    });
    await owner.post('/tasks', {
      sectionId,
      title: 'Pay rates',
      notes: 'municipal account',
      dueDate: addDays(today, 10),
    });
    const parent = await owner.post('/tasks', { sectionId, title: 'Groceries' });
    await owner.post('/tasks', { sectionId, parentTaskId: parent.body.id, title: 'Buy lemons' });
    await owner.post(`/tasks/${a.body.id}/completion`, { completed: true });

    expect(titles((await owner.get('/tasks?status=done')).body)).toEqual(['Mow lawn']);
    expect(titles((await owner.get(`/tasks?assigneeId=${sam.id}`)).body)).toEqual(['Mow lawn']);
    expect(titles((await owner.get('/tasks?assigneeId=none')).body)).toEqual([
      'Pay rates',
      'Groceries',
    ]);
    expect(titles((await owner.get(`/tasks?labelId=${label.body.id}`)).body)).toEqual(['Mow lawn']);
    expect(titles((await owner.get('/tasks?priority=high,urgent')).body)).toEqual(['Mow lawn']);
    expect(titles((await owner.get(`/tasks?dueFrom=${addDays(today, 1)}`)).body)).toEqual([
      'Pay rates',
    ]);
    expect(titles((await owner.get('/tasks?query=municipal')).body)).toEqual(['Pay rates']);
    expect(titles((await owner.get('/tasks?query=lemon')).body)).toEqual(['Groceries']);
    expect(titles((await owner.get('/tasks?query=100%25')).body)).toEqual([]);
    expect((await owner.get('/tasks?status=bogus')).status).toBe(400);
  });

  it('returns dated tasks for a calendar range', async () => {
    const today = context.today;
    await owner.post('/tasks', { sectionId, title: 'Due today', dueDate: today });
    await owner.post('/tasks', { sectionId, title: 'Starts later', startDate: addDays(today, 3) });
    await owner.post('/tasks', { sectionId, title: 'Undated' });
    const calendar = await owner.get(`/calendar?from=${today}&to=${addDays(today, 7)}`);
    expect(titles(calendar.body)).toEqual(['Due today', 'Starts later']);
    expect((await owner.get(`/calendar?from=${today}&to=${addDays(today, -1)}`)).status).toBe(400);
  });
});

describe('labels', () => {
  it('rejects duplicate names case-insensitively and cleans up on delete', async () => {
    const label = await owner.post('/labels', { name: 'Urgent' });
    expect((await owner.post('/labels', { name: 'urgent' })).status).toBe(409);
    const task = await owner.post('/tasks', { sectionId, title: 'x', labelIds: [label.body.id] });
    await owner.delete(`/labels/${label.body.id}`);
    expect((await owner.get(`/tasks/${task.body.id}`)).body.labels).toEqual([]);
  });
});
