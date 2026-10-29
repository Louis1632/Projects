import { sql } from 'drizzle-orm';
import { bootstrapOwner, createDb, type Database } from '@tido/db';
import { buildApp, type App } from '../../src/app';
import { loadConfig, type Config } from '../../src/config';
import { todayIn } from '../../src/lib/dates';
import { testDatabaseUrl } from './database-url';

export const ORIGIN = 'http://tido.test';
export const PASSWORD = 'correct horse battery staple';

export interface TestContext {
  app: App;
  db: Database;
  config: Config;
  today: string;
  close: () => Promise<void>;
}

export async function createTestApp(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    WEB_ORIGIN: ORIGIN,
    SESSION_SECRET: 'integration-test-secret-that-is-long-enough',
    LOG_LEVEL: 'silent',
    API_DOCS: 'false',
    RATE_LIMIT_MAX: '100000',
    LOGIN_RATE_LIMIT_MAX: '100000',
  });
  const { db, close } = createDb(testDatabaseUrl, { max: 5 });
  const app = await buildApp({ config, db, logger: false });
  await app.ready();
  return {
    app,
    db,
    config,
    today: todayIn(config.workspaceTimezone),
    close: async () => {
      await app.close();
      await close();
    },
  };
}

export async function resetDatabase(db: Database) {
  await db.execute(sql`
    TRUNCATE audit_events, recurrence_exceptions, task_completions, task_labels, tasks,
      recurrence_series, labels, sections, projects, account_tokens, sessions,
      workspace_members, workspaces, users RESTART IDENTITY CASCADE
  `);
}

export interface Response<T = any> {
  status: number;
  body: T;
}

/** A cookie-holding API client that behaves like the web app (CSRF header, same origin). */
export class Client {
  cookie?: string;

  constructor(private readonly app: App) {}

  async request<T = any>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response<T>> {
    const response = await this.app.inject({
      method,
      url: `/api/v1${url}`,
      payload: body as object | undefined,
      headers: {
        origin: ORIGIN,
        'x-csrf-request': '1',
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...headers,
      },
    });
    const setCookie = response.headers['set-cookie'];
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) {
      const pair = first.split(';')[0]!;
      this.cookie = pair.endsWith('=') ? undefined : pair;
    }
    return {
      status: response.statusCode,
      body: (response.body ? response.json() : undefined) as T,
    };
  }

  get = <T = any>(url: string) => this.request<T>('GET', url);
  post = <T = any>(url: string, body?: unknown) => this.request<T>('POST', url, body ?? {});
  patch = <T = any>(url: string, body: unknown) => this.request<T>('PATCH', url, body);
  delete = <T = any>(url: string) => this.request<T>('DELETE', url);
}

export const tokenFrom = (url: string) => url.split('/').pop()!;

export async function setupOwner(context: TestContext, email = 'owner@example.test') {
  const link = await bootstrapOwner(context.db, {
    email,
    displayName: 'Olive Owner',
    workspaceName: 'Home',
    timezone: context.config.workspaceTimezone,
    tokenSecret: context.config.sessionSecret,
    webOrigin: ORIGIN,
  });
  const owner = new Client(context.app);
  const accepted = await owner.post('/auth/tokens/accept', {
    token: tokenFrom(link.url),
    password: PASSWORD,
  });
  if (accepted.status !== 200)
    throw new Error(`owner setup failed: ${JSON.stringify(accepted.body)}`);
  return { owner, user: accepted.body };
}

export async function addMember(
  context: TestContext,
  owner: Client,
  email: string,
  role: 'owner' | 'member' = 'member',
) {
  const invite = await owner.post('/members/invites', {
    email,
    displayName: email.split('@')[0],
    role,
  });
  if (invite.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  const client = new Client(context.app);
  const accepted = await client.post('/auth/tokens/accept', {
    token: tokenFrom(invite.body.link.url),
    password: PASSWORD,
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  return { client, user: accepted.body };
}

/** Creates a list and returns it with its default section id. */
export async function createList(client: Client, name = 'House') {
  const project = await client.post('/projects', { name });
  const dashboard = await client.get('/dashboard');
  const section = dashboard.body.projects.find((p: { id: string }) => p.id === project.body.id)
    .sections[0];
  return { projectId: project.body.id as string, sectionId: section.id as string };
}
