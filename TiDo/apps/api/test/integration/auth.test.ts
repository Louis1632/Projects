import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditEvents, bootstrapOwner, BootstrapError, sessions, users } from '@tido/db';
import {
  addMember,
  Client,
  createTestApp,
  ORIGIN,
  PASSWORD,
  resetDatabase,
  setupOwner,
  tokenFrom,
  type TestContext,
} from './helpers';

let context: TestContext;

beforeAll(async () => {
  context = await createTestApp();
});
afterAll(async () => {
  await context.close();
});
beforeEach(async () => {
  await resetDatabase(context.db);
});

describe('bootstrap', () => {
  it('creates the first owner once and refuses afterwards', async () => {
    const { user } = await setupOwner(context);
    expect(user.role).toBe('owner');
    expect(user.workspace.timezone).toBe('Africa/Johannesburg');

    await expect(
      bootstrapOwner(context.db, {
        email: 'second@example.test',
        displayName: 'Second',
        workspaceName: 'Home',
        timezone: 'Africa/Johannesburg',
        tokenSecret: context.config.sessionSecret,
        webOrigin: ORIGIN,
      }),
    ).rejects.toBeInstanceOf(BootstrapError);
  });

  it('stores Argon2id password hashes, never plain text', async () => {
    await setupOwner(context);
    const [row] = await context.db.select().from(users);
    expect(row!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });
});

describe('sessions', () => {
  it('blocks unauthenticated access to workspace data', async () => {
    await setupOwner(context);
    const anonymous = new Client(context.app);
    for (const url of [
      '/dashboard',
      '/tasks',
      '/members',
      '/auth/me',
      '/calendar?from=2026-01-01&to=2026-01-31',
    ]) {
      expect((await anonymous.get(url)).status).toBe(401);
    }
    expect((await anonymous.post('/projects', { name: 'x' })).status).toBe(401);
  });

  it('uses one generic message for unknown emails and wrong passwords', async () => {
    await setupOwner(context);
    const client = new Client(context.app);
    const unknown = await client.post('/auth/login', {
      email: 'nobody@example.test',
      password: PASSWORD,
    });
    const wrong = await client.post('/auth/login', {
      email: 'owner@example.test',
      password: 'wrong password!!',
    });
    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    const failures = await context.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'auth.login_failed'));
    expect(failures).toHaveLength(2);
  });

  it('sets an HTTP-only SameSite cookie and stores only a hash of the token', async () => {
    await setupOwner(context);
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, 'x-csrf-request': '1' },
      payload: { email: 'owner@example.test', password: PASSWORD },
    });
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const token = cookie.split(';')[0]!.split('=')[1]!;
    const stored = await context.db.select({ hash: sessions.tokenHash }).from(sessions);
    expect(stored.every((row) => row.hash !== token)).toBe(true);
  });

  it('logout revokes the session server-side', async () => {
    const { owner } = await setupOwner(context);
    const stolen = owner.cookie!;
    expect((await owner.post('/auth/logout')).status).toBe(200);
    const replay = new Client(context.app);
    replay.cookie = stolen;
    expect((await replay.get('/auth/me')).status).toBe(401);
  });

  it('changing the password rotates the session and signs out other devices', async () => {
    const { owner } = await setupOwner(context);
    const laptop = new Client(context.app);
    await laptop.post('/auth/login', { email: 'owner@example.test', password: PASSWORD });
    const before = owner.cookie;

    const wrong = await owner.post('/auth/password', {
      currentPassword: 'not it at all',
      newPassword: 'a brand new passphrase',
    });
    expect(wrong.status).toBe(400);
    const changed = await owner.post('/auth/password', {
      currentPassword: PASSWORD,
      newPassword: 'a brand new passphrase',
    });
    expect(changed.status).toBe(200);
    expect(owner.cookie).not.toBe(before);
    expect((await owner.get('/auth/me')).status).toBe(200);
    expect((await laptop.get('/auth/me')).status).toBe(401);
  });
});

describe('CSRF and origin protection', () => {
  it('rejects state-changing requests without the custom header', async () => {
    const { owner } = await setupOwner(context);
    const response = await owner.request(
      'POST',
      '/projects',
      { name: 'x' },
      { 'x-csrf-request': '' },
    );
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('csrf_failed');
  });

  it('rejects requests from a foreign origin', async () => {
    const { owner } = await setupOwner(context);
    const response = await owner.request(
      'POST',
      '/projects',
      { name: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(response.status).toBe(403);
  });
});

describe('owner-managed accounts', () => {
  it('invites a member with a single-use link', async () => {
    const { owner } = await setupOwner(context);
    const invite = await owner.post('/members/invites', {
      email: 'Sam@Example.test',
      displayName: 'Sam',
    });
    expect(invite.status).toBe(201);
    expect(invite.body.member).toMatchObject({
      email: 'sam@example.test',
      pending: true,
      role: 'member',
    });

    const token = tokenFrom(invite.body.link.url);
    const anonymous = new Client(context.app);
    expect((await anonymous.get(`/auth/tokens/${token}`)).body).toMatchObject({
      kind: 'invite',
      email: 'sam@example.test',
    });
    const accepted = await anonymous.post('/auth/tokens/accept', {
      token,
      password: PASSWORD,
      displayName: 'Samantha',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.displayName).toBe('Samantha');

    const reuse = await new Client(context.app).post('/auth/tokens/accept', {
      token,
      password: PASSWORD,
    });
    expect(reuse.status).toBe(404);
  });

  it('rejects short passwords when accepting an invite', async () => {
    const { owner } = await setupOwner(context);
    const invite = await owner.post('/members/invites', {
      email: 'sam@example.test',
      displayName: 'Sam',
    });
    const response = await new Client(context.app).post('/auth/tokens/accept', {
      token: tokenFrom(invite.body.link.url),
      password: 'short',
    });
    expect(response.status).toBe(400);
  });

  it('keeps owner-only controls away from members', async () => {
    const { owner } = await setupOwner(context);
    const { client: member } = await addMember(context, owner, 'sam@example.test');
    const ownerId = (await owner.get('/auth/me')).body.id;
    expect(
      (await member.post('/members/invites', { email: 'x@example.test', displayName: 'X' })).status,
    ).toBe(403);
    expect((await member.post(`/members/${ownerId}/deactivate`)).status).toBe(403);
    expect((await member.post(`/members/${ownerId}/reset-link`)).status).toBe(403);
    expect((await member.patch(`/members/${ownerId}/role`, { role: 'member' })).status).toBe(403);
    // Members can still read the member list for assignment.
    expect((await member.get('/members')).status).toBe(200);
  });

  it('deactivation signs the member out and blocks login', async () => {
    const { owner } = await setupOwner(context);
    const { client: member, user } = await addMember(context, owner, 'sam@example.test');
    expect((await owner.post(`/members/${user.id}/deactivate`)).status).toBe(200);
    expect((await member.get('/dashboard')).status).toBe(401);
    const login = await new Client(context.app).post('/auth/login', {
      email: 'sam@example.test',
      password: PASSWORD,
    });
    expect(login.status).toBe(401);
  });

  it('a reset link replaces the password and revokes existing sessions', async () => {
    const { owner } = await setupOwner(context);
    const { client: member, user } = await addMember(context, owner, 'sam@example.test');
    const link = await owner.post(`/members/${user.id}/reset-link`);
    expect(link.body.url).toContain('/reset/');
    const fresh = new Client(context.app);
    expect(
      (
        await fresh.post('/auth/tokens/accept', {
          token: tokenFrom(link.body.url),
          password: 'another long password',
        })
      ).status,
    ).toBe(200);
    expect((await member.get('/auth/me')).status).toBe(401);
    expect((await fresh.get('/auth/me')).status).toBe(200);
  });

  it('never leaves the workspace without an active owner', async () => {
    const { owner } = await setupOwner(context);
    const me = (await owner.get('/auth/me')).body;
    expect((await owner.post(`/members/${me.id}/deactivate`)).status).toBe(400);
    const demote = await owner.patch(`/members/${me.id}/role`, { role: 'member' });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe('last_owner');

    const { user: second } = await addMember(context, owner, 'second@example.test', 'owner');
    expect((await owner.patch(`/members/${me.id}/role`, { role: 'member' })).status).toBe(200);
    expect((await owner.post(`/members/${second.id}/deactivate`)).status).toBe(403);
  });
});
