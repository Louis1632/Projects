import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idSchema,
  labelCreateSchema,
  labelSchema,
  labelUpdateSchema,
  okSchema,
  type Label,
} from '@tido/contracts';
import { labels, recurrenceSeries, type Executor } from '@tido/db';
import { notFound } from '../../errors';
import { requireAuth } from '../../types';

const idParams = z.object({ id: idSchema });

export async function listLabels(exec: Executor, workspaceId: string): Promise<Label[]> {
  return exec
    .select({ id: labels.id, name: labels.name, color: labels.color })
    .from(labels)
    .where(eq(labels.workspaceId, workspaceId))
    .orderBy(asc(labels.name));
}

export const labelRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/labels', { schema: { response: { 200: z.array(labelSchema) } } }, async (request) =>
    listLabels(app.db, requireAuth(request.auth).workspaceId),
  );

  app.post(
    '/labels',
    { schema: { body: labelCreateSchema, response: { 201: labelSchema } } },
    async (request, reply) => {
      const auth = requireAuth(request.auth);
      const [created] = await app.db
        .insert(labels)
        .values({
          workspaceId: auth.workspaceId,
          name: request.body.name,
          color: request.body.color ?? null,
        })
        .returning({ id: labels.id, name: labels.name, color: labels.color });
      return reply.status(201).send(created!);
    },
  );

  app.patch(
    '/labels/:id',
    { schema: { params: idParams, body: labelUpdateSchema, response: { 200: labelSchema } } },
    async (request) => {
      const auth = requireAuth(request.auth);
      const [updated] = await app.db
        .update(labels)
        .set({ ...request.body, updatedAt: new Date() })
        .where(and(eq(labels.id, request.params.id), eq(labels.workspaceId, auth.workspaceId)))
        .returning({ id: labels.id, name: labels.name, color: labels.color });
      if (!updated) throw notFound('That label');
      return updated;
    },
  );

  app.delete(
    '/labels/:id',
    { schema: { params: idParams, response: { 200: okSchema } } },
    async (request) => {
      const auth = requireAuth(request.auth);
      await app.db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(labels)
          .where(and(eq(labels.id, request.params.id), eq(labels.workspaceId, auth.workspaceId)))
          .returning({ id: labels.id });
        if (!deleted) throw notFound('That label');
        await tx
          .update(recurrenceSeries)
          .set({ labelIds: sql`array_remove(${recurrenceSeries.labelIds}, ${deleted.id}::uuid)` })
          .where(eq(recurrenceSeries.workspaceId, auth.workspaceId));
      });
      return { ok: true as const };
    },
  );
};
