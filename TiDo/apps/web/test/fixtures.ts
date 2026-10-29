import type { Dashboard, SessionUser, Task } from '@tido/contracts';
import { vi } from 'vitest';

export const user: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'owner@example.test',
  displayName: 'Olive',
  role: 'owner',
  workspace: {
    id: '00000000-0000-4000-8000-0000000000aa',
    name: 'Home',
    timezone: 'Africa/Johannesburg',
  },
};

let counter = 100;
export function makeTask(overrides: Partial<Task> = {}): Task {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    projectId: '00000000-0000-4000-8000-0000000000b1',
    sectionId: '00000000-0000-4000-8000-0000000000c1',
    parentTaskId: null,
    title: 'Task',
    notes: null,
    status: 'todo',
    priority: 'medium',
    assigneeId: null,
    startDate: null,
    dueDate: null,
    position: 0,
    revision: 1,
    completedAt: null,
    completedBy: null,
    archivedAt: null,
    createdBy: user.id,
    updatedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    labels: [],
    recurrence: null,
    subtasks: [],
    ...overrides,
  };
}

export function makeDashboard(tasks: Task[]): Dashboard {
  return {
    projects: [
      {
        id: '00000000-0000-4000-8000-0000000000b1',
        name: 'House',
        description: null,
        color: null,
        position: 0,
        revision: 1,
        archivedAt: null,
        sections: [
          {
            id: '00000000-0000-4000-8000-0000000000c1',
            projectId: '00000000-0000-4000-8000-0000000000b1',
            name: 'Tasks',
            position: 0,
            revision: 1,
            archivedAt: null,
            tasks,
          },
        ],
      },
    ],
    members: [
      {
        id: user.id,
        email: user.email,
        displayName: 'Olive',
        role: 'owner',
        active: true,
        pending: false,
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        email: 'sam@example.test',
        displayName: 'Sam',
        role: 'member',
        active: true,
        pending: false,
        joinedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    labels: [{ id: '00000000-0000-4000-8000-0000000000d1', name: 'Garden', color: '#2f855a' }],
  };
}

type Handler = (request: { method: string; url: URL; body: unknown }) => {
  status?: number;
  body?: unknown;
};

/** Replaces fetch with a tiny router; returns the recorded requests for assertions. */
export function mockApi(handlers: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url = new URL(input, 'http://localhost');
      const method = init.method ?? 'GET';
      const path = url.pathname.replace('/api/v1', '');
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, path, body });
      const handler = handlers[`${method} ${path}`];
      const result = handler
        ? handler({ method, url, body })
        : { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } };
      return new Response(JSON.stringify(result.body ?? {}), {
        status: result.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return calls;
}
