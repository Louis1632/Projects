import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  changePasswordSchema,
  tokenAcceptSchema,
  loginSchema,
  okSchema,
  sessionUserSchema,
  tokenInfoSchema,
  tokenLookupSchema,
  type SessionUser,
} from '@tido/contracts';
import { users, workspaceMembers, workspaces } from '@tido/db';
import { AppError, badRequest, notFound } from '../../errors';
import { audit } from '../../lib/audit';
import { hashPassword, verifyPassword } from '../../lib/passwords';
import { clearSessionCookie, setSessionCookie } from '../../plugins/auth';
import { requireAuth, type AuthContext } from '../../types';
import { findUsableToken, markTokenUsed } from './account-tokens';
import { LoginThrottle } from './login-throttle';
import { createSession, revokeAllSessions, revokeSession } from './sessions';

const INVALID_LOGIN = 'Invalid email or password.';
const invalidLink = () =>
  new AppError(404, 'link_invalid', 'This link has expired or was already used.');

export function toSessionUser(auth: AuthContext): SessionUser {
  return {
    id: auth.userId,
    email: auth.email,
    displayName: auth.displayName,
    role: auth.role,
    workspace: { id: auth.workspaceId, name: auth.workspaceName, timezone: auth.timezone },
  };
}

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  const throttle = new LoginThrottle();
  // A stolen session must not become a fast way to guess the account's password.
  const passwordThrottle = new LoginThrottle();

  async function sessionUserFor(userId: string): Promise<SessionUser> {
    const [row] = await app.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: workspaceMembers.role,
        workspace: { id: workspaces.id, name: workspaces.name, timezone: workspaces.timezone },
      })
      .from(users)
      .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(users.id, userId));
    if (!row) throw notFound('Account');
    return row;
  }

  app.post(
    '/auth/login',
    {
      config: {
        public: true,
        rateLimit: { max: app.config.loginRateLimitMax, timeWindow: '1 minute' },
      },
      schema: { body: loginSchema, response: { 200: sessionUserSchema } },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      if (throttle.isBlocked(email)) {
        throw new AppError(429, 'rate_limited', 'Too many sign-in attempts. Try again later.');
      }

      const [user] = await app.db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          isActive: users.isActive,
          workspaceId: workspaceMembers.workspaceId,
        })
        .from(users)
        .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
        .where(eq(users.email, email))
        .limit(1);

      const valid = await verifyPassword(user?.isActive ? user.passwordHash : null, password);
      if (!user || !valid) {
        throttle.recordFailure(email);
        await audit(app.db, {
          workspaceId: user?.workspaceId ?? null,
          actorId: null,
          action: 'auth.login_failed',
          metadata: { email },
          ip: request.ip,
        });
        throw new AppError(401, 'invalid_credentials', INVALID_LOGIN);
      }

      throttle.reset(email);
      // Rotate: any session presented with this request is replaced by a fresh one.
      if (request.auth) await revokeSession(app.db, request.auth.sessionId);
      const session = await createSession(app.db, app.config.sessionSecret, user.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      await audit(app.db, {
        workspaceId: user.workspaceId,
        actorId: user.id,
        action: 'auth.login',
        ip: request.ip,
      });
      setSessionCookie(app, reply, session);
      return sessionUserFor(user.id);
    },
  );

  app.post(
    '/auth/logout',
    { config: { public: true }, schema: { response: { 200: okSchema } } },
    async (request, reply) => {
      if (request.auth) {
        await revokeSession(app.db, request.auth.sessionId);
        await audit(app.db, {
          workspaceId: request.auth.workspaceId,
          actorId: request.auth.userId,
          action: 'auth.logout',
          ip: request.ip,
        });
      }
      clearSessionCookie(app, reply);
      return { ok: true as const };
    },
  );

  app.get('/auth/me', { schema: { response: { 200: sessionUserSchema } } }, async (request) =>
    toSessionUser(requireAuth(request.auth)),
  );

  app.post(
    '/auth/password',
    { schema: { body: changePasswordSchema, response: { 200: sessionUserSchema } } },
    async (request, reply) => {
      const auth = requireAuth(request.auth);
      if (passwordThrottle.isBlocked(auth.userId)) {
        throw new AppError(429, 'rate_limited', 'Too many attempts. Try again later.');
      }
      const [user] = await app.db
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .where(eq(users.id, auth.userId));
      if (!(await verifyPassword(user?.passwordHash ?? null, request.body.currentPassword))) {
        passwordThrottle.recordFailure(auth.userId);
        throw badRequest('Your current password is incorrect.', 'invalid_password');
      }
      passwordThrottle.reset(auth.userId);
      const passwordHash = await hashPassword(request.body.newPassword);
      const session = await app.db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, auth.userId));
        await revokeAllSessions(tx, auth.userId);
        await audit(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: 'auth.password_changed',
          ip: request.ip,
        });
        return createSession(tx, app.config.sessionSecret, auth.userId, {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        });
      });
      setSessionCookie(app, reply, session);
      return toSessionUser(auth);
    },
  );

  // POST, so the token travels in the body and never lands in access logs or trace URLs.
  app.post(
    '/auth/tokens/lookup',
    {
      config: {
        public: true,
        rateLimit: { max: app.config.loginRateLimitMax * 3, timeWindow: '1 minute' },
      },
      schema: { body: tokenLookupSchema, response: { 200: tokenInfoSchema } },
    },
    async (request) => {
      const token = await findUsableToken(app.db, app.config.sessionSecret, request.body.token);
      if (!token) throw invalidLink();
      return { email: token.email, displayName: token.displayName, kind: token.kind };
    },
  );

  app.post(
    '/auth/tokens/accept',
    {
      config: {
        public: true,
        rateLimit: { max: app.config.loginRateLimitMax, timeWindow: '1 minute' },
      },
      schema: { body: tokenAcceptSchema, response: { 200: sessionUserSchema } },
    },
    async (request, reply) => {
      const { token, password, displayName } = request.body;
      const found = await findUsableToken(app.db, app.config.sessionSecret, token);
      if (!found) throw invalidLink();
      const passwordHash = await hashPassword(password);

      const session = await app.db.transaction(async (tx) => {
        if (!(await markTokenUsed(tx, found.id))) {
          throw invalidLink();
        }
        await tx
          .update(users)
          .set({
            passwordHash,
            displayName: found.kind === 'invite' && displayName ? displayName : found.displayName,
            updatedAt: new Date(),
          })
          .where(eq(users.id, found.userId));
        await revokeAllSessions(tx, found.userId);
        const [member] = await tx
          .select({ workspaceId: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.userId, found.userId));
        await audit(tx, {
          workspaceId: member?.workspaceId ?? null,
          actorId: found.userId,
          action: found.kind === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset',
          ip: request.ip,
        });
        return createSession(tx, app.config.sessionSecret, found.userId, {
          userAgent: request.headers['user-agent'],
          ip: request.ip,
        });
      });
      setSessionCookie(app, reply, session);
      return sessionUserFor(found.userId);
    },
  );
};
