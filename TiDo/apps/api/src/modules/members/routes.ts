import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  accountLinkSchema,
  idSchema,
  inviteCreateSchema,
  memberRoleUpdateSchema,
  memberSchema,
  type Member,
} from '@tido/contracts';
import { accountTokens, users, workspaceMembers, type Executor } from '@tido/db';
import { badRequest, conflict, notFound } from '../../errors';
import { audit } from '../../lib/audit';
import { iso } from '../../lib/dates';
import { requireAuth, type AuthContext } from '../../types';
import { issueAccountLink } from '../auth/account-tokens';
import { revokeAllSessions } from '../auth/sessions';

const userParams = z.object({ userId: idSchema });
const inviteResponse = z.object({ member: memberSchema, link: accountLinkSchema });

export async function listMembers(exec: Executor, workspaceId: string): Promise<Member[]> {
  const rows = await exec
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      role: workspaceMembers.role,
      active: users.isActive,
      pending: sql<boolean>`${users.passwordHash} IS NULL`,
      joinedAt: workspaceMembers.joinedAt,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(users.displayName));
  return rows.map((row) => ({ ...row, joinedAt: iso(row.joinedAt) }));
}

async function getMember(exec: Executor, auth: AuthContext, userId: string): Promise<Member> {
  const member = (await listMembers(exec, auth.workspaceId)).find((row) => row.id === userId);
  if (!member) throw notFound('That member');
  return member;
}

async function assertNotLastOwner(exec: Executor, auth: AuthContext, userId: string) {
  const [result] = await exec
    .select({ count: sql<number>`count(*)::int` })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, auth.workspaceId),
        eq(workspaceMembers.role, 'owner'),
        eq(users.isActive, true),
        ne(users.id, userId),
      ),
    );
  if ((result?.count ?? 0) === 0) {
    throw conflict('The workspace needs at least one active owner.', 'last_owner');
  }
}

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  const linkOptions = { secret: app.config.sessionSecret, webOrigin: app.config.webOrigin };

  app.get('/members', { schema: { response: { 200: z.array(memberSchema) } } }, async (request) =>
    listMembers(app.db, requireAuth(request.auth).workspaceId),
  );

  app.post(
    '/members/invites',
    {
      config: { ownerOnly: true },
      schema: { body: inviteCreateSchema, response: { 201: inviteResponse } },
    },
    async (request, reply) => {
      const auth = requireAuth(request.auth);
      const { email, displayName, role } = request.body;
      const result = await app.db.transaction(async (tx) => {
        let [user] = await tx.select().from(users).where(eq(users.email, email));
        if (user?.passwordHash) {
          throw conflict('Someone with that email already has an account.', 'member_exists');
        }
        if (!user) {
          [user] = await tx.insert(users).values({ email, displayName }).returning();
        } else {
          await tx
            .update(users)
            .set({ displayName, isActive: true, updatedAt: new Date() })
            .where(eq(users.id, user.id));
        }
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: auth.workspaceId, userId: user!.id, role })
          .onConflictDoUpdate({
            target: [workspaceMembers.workspaceId, workspaceMembers.userId],
            set: { role },
          });
        const link = await issueAccountLink(tx, {
          ...linkOptions,
          userId: user!.id,
          kind: 'invite',
          createdBy: auth.userId,
        });
        await audit(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: 'member.invited',
          targetType: 'user',
          targetId: user!.id,
          metadata: { email, role },
          ip: request.ip,
        });
        return { member: await getMember(tx, auth, user!.id), link };
      });
      return reply.status(201).send(result);
    },
  );

  app.post(
    '/members/:userId/reset-link',
    {
      config: { ownerOnly: true },
      schema: { params: userParams, response: { 200: accountLinkSchema } },
    },
    async (request) => {
      const auth = requireAuth(request.auth);
      return app.db.transaction(async (tx) => {
        const member = await getMember(tx, auth, request.params.userId);
        if (!member.active) throw badRequest('Reactivate this member first.');
        const link = await issueAccountLink(tx, {
          ...linkOptions,
          userId: member.id,
          kind: member.pending ? 'invite' : 'password_reset',
          createdBy: auth.userId,
        });
        await audit(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: member.pending ? 'member.invite_reissued' : 'member.reset_link_issued',
          targetType: 'user',
          targetId: member.id,
          ip: request.ip,
        });
        return link;
      });
    },
  );

  app.post(
    '/members/:userId/deactivate',
    {
      config: { ownerOnly: true },
      schema: { params: userParams, response: { 200: memberSchema } },
    },
    async (request) => {
      const auth = requireAuth(request.auth);
      const { userId } = request.params;
      if (userId === auth.userId) throw badRequest('You cannot deactivate your own account.');
      return app.db.transaction(async (tx) => {
        const member = await getMember(tx, auth, userId);
        if (member.role === 'owner') await assertNotLastOwner(tx, auth, userId);
        await tx
          .update(users)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(users.id, userId));
        await revokeAllSessions(tx, userId);
        await tx
          .update(accountTokens)
          .set({ revokedAt: sql`now()` })
          .where(and(eq(accountTokens.userId, userId), sql`${accountTokens.usedAt} IS NULL`));
        await audit(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: 'member.deactivated',
          targetType: 'user',
          targetId: userId,
          ip: request.ip,
        });
        return getMember(tx, auth, userId);
      });
    },
  );

  app.post(
    '/members/:userId/reactivate',
    {
      config: { ownerOnly: true },
      schema: { params: userParams, response: { 200: memberSchema } },
    },
    async (request) => {
      const auth = requireAuth(request.auth);
      return app.db.transaction(async (tx) => {
        await getMember(tx, auth, request.params.userId);
        await tx
          .update(users)
          .set({ isActive: true, updatedAt: new Date() })
          .where(eq(users.id, request.params.userId));
        await audit(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: 'member.reactivated',
          targetType: 'user',
          targetId: request.params.userId,
          ip: request.ip,
        });
        return getMember(tx, auth, request.params.userId);
      });
    },
  );

  app.patch(
    '/members/:userId/role',
    {
      config: { ownerOnly: true },
      schema: { params: userParams, body: memberRoleUpdateSchema, response: { 200: memberSchema } },
    },
    async (request) => {
      const auth = requireAuth(request.auth);
      const { userId } = request.params;
      return app.db.transaction(async (tx) => {
        const member = await getMember(tx, auth, userId);
        if (member.role === 'owner' && request.body.role === 'member') {
          await assertNotLastOwner(tx, auth, userId);
        }
        await tx
          .update(workspaceMembers)
          .set({ role: request.body.role })
          .where(
            and(
              eq(workspaceMembers.workspaceId, auth.workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          );
        await audit(tx, {
          workspaceId: auth.workspaceId,
          actorId: auth.userId,
          action: 'member.role_changed',
          targetType: 'user',
          targetId: userId,
          metadata: { from: member.role, to: request.body.role },
          ip: request.ip,
        });
        return getMember(tx, auth, userId);
      });
    },
  );
};
