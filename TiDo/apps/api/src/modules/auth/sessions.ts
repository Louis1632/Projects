import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import {
  generateToken,
  hashToken,
  sessions,
  users,
  workspaceMembers,
  workspaces,
  type Executor,
} from '@tido/db';
import type { AuthContext } from '../../types';

export const SESSION_IDLE_MS = 7 * 24 * 3_600_000;
export const SESSION_ABSOLUTE_MS = 30 * 24 * 3_600_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;

export interface NewSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  exec: Executor,
  secret: string,
  userId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<NewSession> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_ABSOLUTE_MS);
  await exec.insert(sessions).values({
    userId,
    tokenHash: hashToken(token, secret, 'session'),
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 500),
    ipAddress: meta.ip,
  });
  return { token, expiresAt };
}

export async function resolveSession(
  exec: Executor,
  secret: string,
  token: string,
): Promise<AuthContext | null> {
  const now = new Date();
  const [row] = await exec
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMembers.role,
      workspaceId: workspaces.id,
      workspaceName: workspaces.name,
      timezone: workspaces.timezone,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token, secret, 'session')),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.lastSeenAt, new Date(now.getTime() - SESSION_IDLE_MS)),
        eq(users.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await exec.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
  }
  const { lastSeenAt: _lastSeenAt, ...auth } = row;
  return auth;
}

export async function revokeSession(exec: Executor, sessionId: string): Promise<void> {
  await exec
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export async function revokeAllSessions(exec: Executor, userId: string): Promise<void> {
  await exec
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}
