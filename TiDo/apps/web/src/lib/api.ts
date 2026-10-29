import type {
  AccountLink,
  CompletionEntry,
  Dashboard,
  InviteCreateInput,
  Label,
  Member,
  Project,
  ProjectUpdateInput,
  RecurrenceScope,
  Role,
  Section,
  SectionUpdateInput,
  SessionUser,
  Task,
  TaskCreateInput,
  TaskMoveInput,
  TaskUpdateInput,
  TokenAcceptInput,
  TokenInfo,
} from '@tido/contracts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const method = rest.method ?? 'GET';
  const headers = new Headers(rest.headers);
  headers.set('accept', 'application/json');
  if (json !== undefined) headers.set('content-type', 'application/json');
  // The API rejects state-changing requests without this header (CSRF defence).
  if (!/^(GET|HEAD|OPTIONS)$/i.test(method)) headers.set('x-csrf-request', '1');

  const response = await fetch(`/api/v1${path}`, {
    ...rest,
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string; details?: unknown };
    };
    throw new ApiError(
      payload.error?.message ?? 'Something went wrong. Please try again.',
      response.status,
      payload.error?.code,
      payload.error?.details,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** A readable message for any thrown value, including the first field-level problem. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const first = Array.isArray(error.details)
      ? (error.details[0] as { message?: string } | undefined)
      : undefined;
    return first?.message && error.code === 'validation_error'
      ? `${error.message} ${first.message}`
      : error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  session: () => request<SessionUser>('/auth/me'),
  login: (email: string, password: string) =>
    request<SessionUser>('/auth/login', { method: 'POST', json: { email, password } }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<SessionUser>('/auth/password', {
      method: 'POST',
      json: { currentPassword, newPassword },
    }),
  tokenInfo: (token: string) => request<TokenInfo>(`/auth/tokens/${encodeURIComponent(token)}`),
  acceptToken: (input: TokenAcceptInput) =>
    request<SessionUser>('/auth/tokens/accept', { method: 'POST', json: input }),

  dashboard: () => request<Dashboard>('/dashboard'),
  calendar: (from: string, to: string) => request<Task[]>(`/calendar${query({ from, to })}`),

  members: () => request<Member[]>('/members'),
  invite: (input: InviteCreateInput) =>
    request<{ member: Member; link: AccountLink }>('/members/invites', {
      method: 'POST',
      json: input,
    }),
  resetLink: (userId: string) =>
    request<AccountLink>(`/members/${userId}/reset-link`, { method: 'POST' }),
  deactivate: (userId: string) =>
    request<Member>(`/members/${userId}/deactivate`, { method: 'POST' }),
  reactivate: (userId: string) =>
    request<Member>(`/members/${userId}/reactivate`, { method: 'POST' }),
  setRole: (userId: string, role: Role) =>
    request<Member>(`/members/${userId}/role`, { method: 'PATCH', json: { role } }),

  createProject: (name: string, color?: string | null) =>
    request<Project>('/projects', { method: 'POST', json: { name, color } }),
  updateProject: (id: string, input: ProjectUpdateInput) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', json: input }),
  createSection: (projectId: string, name: string) =>
    request<Section>(`/projects/${projectId}/sections`, { method: 'POST', json: { name } }),
  updateSection: (id: string, input: SectionUpdateInput) =>
    request<Section>(`/sections/${id}`, { method: 'PATCH', json: input }),

  createLabel: (name: string, color?: string | null) =>
    request<Label>('/labels', { method: 'POST', json: { name, color } }),
  deleteLabel: (id: string) => request<{ ok: true }>(`/labels/${id}`, { method: 'DELETE' }),

  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  createTask: (input: TaskCreateInput) => request<Task>('/tasks', { method: 'POST', json: input }),
  updateTask: (id: string, input: TaskUpdateInput) =>
    request<Task>(`/tasks/${id}`, { method: 'PATCH', json: input }),
  moveTask: (id: string, input: TaskMoveInput) =>
    request<Task>(`/tasks/${id}/move`, { method: 'POST', json: input }),
  completeTask: (id: string, completed: boolean) =>
    request<Task>(`/tasks/${id}/completion`, { method: 'POST', json: { completed } }),
  deleteTask: (id: string, scope: RecurrenceScope = 'occurrence') =>
    request<{ ok: true }>(`/tasks/${id}${query({ scope })}`, { method: 'DELETE' }),
  completions: (id: string) => request<CompletionEntry[]>(`/tasks/${id}/completions`),
};
