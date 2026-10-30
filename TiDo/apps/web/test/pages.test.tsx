import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { addDays, todayIn } from '../src/lib/dates';
import { makeDashboard, makeTask, mockApi, user } from './fixtures';
import { renderApp } from './render';

const today = todayIn('Africa/Johannesburg');
const unauthorized = () => ({
  status: 401,
  body: { error: { code: 'unauthenticated', message: 'Please sign in to continue.' } },
});

describe('authentication', () => {
  it('redirects to sign in and shows a generic error for bad credentials', async () => {
    mockApi({
      'GET /auth/me': unauthorized,
      'POST /auth/login': () => ({
        status: 401,
        body: { error: { code: 'invalid_credentials', message: 'Invalid email or password.' } },
      }),
    });
    renderApp('/tasks');
    await userEvent.type(await screen.findByLabelText('Email'), 'owner@example.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
  });

  it('explains an expired invite link', async () => {
    mockApi({
      'GET /auth/me': unauthorized,
      'POST /auth/tokens/lookup': () => ({
        status: 404,
        body: {
          error: { code: 'link_invalid', message: 'This link has expired or was already used.' },
        },
      }),
    });
    renderApp(`/invite/${'x'.repeat(43)}`);
    expect(
      await screen.findByText('This link has expired or was already used.'),
    ).toBeInTheDocument();
  });
});

describe('task list', () => {
  const tasks = [
    makeTask({
      title: 'Mow lawn',
      dueDate: addDays(today, -2),
      assigneeId: '00000000-0000-4000-8000-000000000002',
    }),
    makeTask({
      title: 'Pay rates',
      dueDate: addDays(today, 3),
      subtasks: [makeTask({ title: 'Find invoice', status: 'done' })],
    }),
    makeTask({ title: 'Clean gutters', status: 'done' }),
  ];

  it('renders sections, overdue dates and subtask progress', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard(tasks) }),
    });
    renderApp('/tasks');
    const section = await screen.findByRole('region', { name: 'House – Tasks' });
    const rows = within(section).getAllByTestId('task-row');
    expect(rows.map((row) => row.querySelector('.task-title')?.textContent)).toEqual([
      'Mow lawn',
      'Pay rates',
      'Clean gutters',
    ]);
    expect(within(rows[0]!).getByText(/◷/)).toHaveClass('overdue');
    expect(within(rows[1]!).getByText('☑ 1/1')).toBeInTheDocument();
  });

  it('filters by status, assignee and search', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard(tasks) }),
    });
    renderApp('/tasks');
    await screen.findByText('Mow lawn');

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'open');
    expect(screen.queryByText('Clean gutters')).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Assigned'), 'none');
    expect(screen.queryByText('Mow lawn')).not.toBeInTheDocument();
    expect(screen.getByText('Pay rates')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await userEvent.type(screen.getByPlaceholderText('Search tasks'), 'invoice');
    expect(screen.getByText('Pay rates')).toBeInTheDocument();
    expect(screen.queryByText('Mow lawn')).not.toBeInTheDocument();
  });

  it('completes a task through the API', async () => {
    const calls = mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard(tasks) }),
      [`POST /tasks/${tasks[0]!.id}/completion`]: () => ({ body: { ...tasks[0], status: 'done' } }),
    });
    renderApp('/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Complete Mow lawn' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/tasks/${tasks[0]!.id}/completion`,
        body: { completed: true },
      }),
    );
  });

  it('hides owner-only navigation from members', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: { ...user, role: 'member' } }),
      'GET /dashboard': () => ({ body: makeDashboard([]) }),
    });
    const { router } = renderApp('/people');
    await screen.findByRole('link', { name: /Calendar/ });
    expect(screen.queryByRole('link', { name: /People/ })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/tasks');
  });
});

describe('section columns', () => {
  const laterId = '00000000-0000-4000-8000-0000000000c2';
  const chore = makeTask({ title: 'Sweep porch' });
  const withTwoSections = () => {
    const dashboard = makeDashboard([chore]);
    const project = dashboard.projects[0]!;
    project.sections.push({
      ...project.sections[0]!,
      id: laterId,
      name: 'Later',
      position: 1,
      tasks: [],
    });
    return dashboard;
  };
  const dataTransfer = () => ({
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: () => undefined,
    setDragImage: () => undefined,
  });

  it('reorders sections with the arrow buttons', async () => {
    const calls = mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: withTwoSections() }),
      [`PATCH /sections/${laterId}`]: () => ({ body: {} }),
    });
    renderApp('/tasks');
    expect(await screen.findByRole('button', { name: 'Move Tasks left' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Move Later left' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/sections/${laterId}`,
        body: { position: 0, revision: 1 },
      }),
    );
  });

  it('moves a task into another section by dragging it there', async () => {
    const calls = mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: withTwoSections() }),
      [`POST /tasks/${chore.id}/move`]: () => ({ body: chore }),
    });
    renderApp('/tasks');
    const row = (await screen.findByText('Sweep porch')).closest('article')!;
    const later = screen.getByRole('region', { name: 'House – Later' });
    fireEvent.dragStart(row, { dataTransfer: dataTransfer() });
    fireEvent.dragOver(later, { dataTransfer: dataTransfer() });
    expect(later).toHaveClass('drop-target');
    fireEvent.drop(later, { dataTransfer: dataTransfer() });
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/tasks/${chore.id}/move`,
        body: { sectionId: laterId, position: 0, revision: 1 },
      }),
    );
    expect(later).not.toHaveClass('drop-target');
  });
});

describe('list and section controls', () => {
  const houseId = '00000000-0000-4000-8000-0000000000b1';
  const sectionId = '00000000-0000-4000-8000-0000000000c1';
  const chore = makeTask({ title: 'Sweep porch' });
  const signedIn = (extra: Parameters<typeof mockApi>[0] = {}) =>
    mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard([chore]) }),
      ...extra,
    });

  it('renames a section by clicking its name', async () => {
    const calls = signedIn({ [`PATCH /sections/${sectionId}`]: () => ({ body: {} }) });
    renderApp(`/projects/${houseId}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Rename section Tasks' }));
    const field = screen.getByLabelText('Section name');
    await userEvent.clear(field);
    await userEvent.type(field, 'This week{Enter}');
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/sections/${sectionId}`,
        body: { name: 'This week', revision: 1 },
      }),
    );
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('adds a section from the + tile after the last column', async () => {
    const calls = signedIn({
      [`POST /projects/${houseId}/sections`]: () => ({ status: 201, body: {} }),
    });
    renderApp(`/projects/${houseId}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Add section' }));
    await userEvent.type(screen.getByLabelText('New section name'), 'Weekend{Enter}');
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: `/projects/${houseId}/sections`,
        body: { name: 'Weekend' },
      }),
    );
    expect(screen.queryByLabelText('New section name')).not.toBeInTheDocument();
  });

  it('adds a subtask straight from the task row', async () => {
    const calls = signedIn({ 'POST /tasks': () => ({ status: 201, body: {} }) });
    renderApp('/tasks');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Add a subtask to Sweep porch' }),
    );
    await userEvent.type(
      screen.getByLabelText('New subtask for Sweep porch'),
      'Get a broom{Enter}',
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/tasks',
        body: {
          sectionId,
          parentTaskId: chore.id,
          title: 'Get a broom',
          repeatSubtask: false,
        },
      }),
    );
    expect(screen.getByLabelText('New subtask for Sweep porch')).toHaveValue('');
  });

  it('adds tasks one after another from the column, keeping the field open', async () => {
    const calls = signedIn({ 'POST /tasks': () => ({ status: 201, body: {} }) });
    renderApp('/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Add a task to Tasks' }));
    const field = screen.getByLabelText('New task in Tasks');
    await userEvent.type(field, 'Water plants{Enter}');
    await waitFor(() => expect(field).toHaveValue(''));
    await userEvent.type(field, 'Feed cat{Enter}');
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
        { sectionId, title: 'Water plants' },
        { sectionId, title: 'Feed cat' },
      ]),
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('New task in Tasks')).not.toBeInTheDocument();
  });

  it('keeps a quick-added title when saving fails', async () => {
    signedIn({
      'POST /tasks': () => ({
        status: 500,
        body: { error: { code: 'internal', message: 'Something went wrong.' } },
      }),
    });
    renderApp('/tasks');
    await userEvent.click(await screen.findByRole('button', { name: 'Add a task to Tasks' }));
    await userEvent.type(screen.getByLabelText('New task in Tasks'), 'Water plants{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong.');
    expect(screen.getByLabelText('New task in Tasks')).toHaveValue('Water plants');
  });

  it('archives a list from the sidebar and leaves its page', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = signedIn({ [`PATCH /projects/${houseId}`]: () => ({ body: {} }) });
    const { router } = renderApp(`/projects/${houseId}`);
    expect(await screen.findByRole('heading', { name: 'House', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive list' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Archive House' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PATCH',
        path: `/projects/${houseId}`,
        body: { archived: true, revision: 1 },
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/tasks'));
  });
});

describe('task editor', () => {
  it('creates a recurring task with the chosen rule', async () => {
    const calls = mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard([]) }),
      'POST /tasks': ({ body }) => ({ status: 201, body: makeTask(body as object) }),
    });
    renderApp('/tasks');
    await userEvent.click(await screen.findByRole('button', { name: '+ New task' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'Water plants');
    await userEvent.selectOptions(within(dialog).getByLabelText('Repeat pattern'), 'weekly');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sat' }));
    expect(within(dialog).getByText(/Repeats every week on/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === 'POST' && call.path === '/tasks')).toBe(true),
    );
    const created = calls.find((call) => call.method === 'POST' && call.path === '/tasks')!
      .body as {
      title: string;
      recurrence: { rrule: string; startsOn: string };
    };
    expect(created.title).toBe('Water plants');
    expect(created.recurrence.rrule).toMatch(/^FREQ=WEEKLY;BYDAY=.*SA/);
    expect(created.recurrence.startsOn).toBe(today);
  });

  it('shows API validation errors without closing', async () => {
    mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard([]) }),
      'POST /tasks': () => ({
        status: 400,
        body: { error: { code: 'invalid_rrule', message: 'That rule repeats too often.' } },
      }),
    });
    renderApp('/tasks');
    await userEvent.click(await screen.findByRole('button', { name: '+ New task' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Title'), 'x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create task' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'That rule repeats too often.',
    );
  });

  it('asks which occurrences to change when editing a recurring task', async () => {
    const recurring = makeTask({
      title: 'Feed cat',
      dueDate: today,
      recurrence: {
        seriesId: '00000000-0000-4000-8000-0000000000e1',
        rrule: 'FREQ=DAILY',
        startsOn: today,
        occurrenceDate: today,
        detached: false,
      },
    });
    const calls = mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard([recurring]) }),
      [`GET /tasks/${recurring.id}`]: () => ({ body: recurring }),
      [`PATCH /tasks/${recurring.id}`]: ({ body }) => ({
        body: { ...recurring, ...(body as object) },
      }),
    });
    renderApp('/tasks');
    await userEvent.click((await screen.findByText('Feed cat')).closest('button')!);
    const dialog = await screen.findByRole('dialog', { name: 'Feed cat' });
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Feed both cats');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'This and following occurrences' }),
    );
    await waitFor(() => {
      const patch = calls.find((call) => call.method === 'PATCH');
      expect(patch?.body).toMatchObject({ title: 'Feed both cats', scope: 'future', revision: 1 });
      expect(patch?.body).not.toHaveProperty('recurrence');
    });
  });
});

describe('calendar', () => {
  it('places tasks on their due dates and lists upcoming work', async () => {
    const soon = makeTask({ title: 'Dentist', dueDate: addDays(today, 1) });
    mockApi({
      'GET /auth/me': () => ({ body: user }),
      'GET /dashboard': () => ({ body: makeDashboard([soon]) }),
      'GET /calendar': () => ({ body: [soon] }),
    });
    const { container } = renderApp('/calendar');
    await screen.findAllByText('Dentist');
    const cell = container.querySelector(`[data-day="${addDays(today, 1)}"]`)!;
    expect(within(cell as HTMLElement).getByText('Dentist')).toBeInTheDocument();
    const agenda = screen.getByRole('complementary', { name: 'Upcoming' });
    expect(within(agenda).getByText('Tomorrow')).toBeInTheDocument();
  });
});
