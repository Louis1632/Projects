import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  idSchema,
  projectCreateSchema,
  projectSchema,
  projectUpdateSchema,
  sectionCreateSchema,
  sectionSchema,
  sectionUpdateSchema,
  type Project,
  type Section,
} from '@tido/contracts';
import { projects, sections, type Executor } from '@tido/db';
import { notFound, staleRevision } from '../../errors';
import { iso } from '../../lib/dates';
import { changedPositions, placeAt } from '../../lib/ordering';
import { requireAuth, type AuthContext } from '../../types';

const idParams = z.object({ id: idSchema });

export function toProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    position: row.position,
    revision: row.revision,
    archivedAt: iso(row.archivedAt),
  };
}

export function toSection(row: typeof sections.$inferSelect): Section {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    position: row.position,
    revision: row.revision,
    archivedAt: iso(row.archivedAt),
  };
}

async function getProject(exec: Executor, auth: AuthContext, id: string) {
  const [row] = await exec
    .select()
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.workspaceId, auth.workspaceId)));
  if (!row) throw notFound('That list');
  return row;
}

export async function getSection(exec: Executor, auth: AuthContext, id: string) {
  const [row] = await exec
    .select()
    .from(sections)
    .where(and(eq(sections.id, id), eq(sections.workspaceId, auth.workspaceId)));
  if (!row) throw notFound('That section');
  return row;
}

export const projectRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/projects',
    {
      schema: {
        querystring: z.object({ includeArchived: z.enum(['true', 'false']).optional() }),
        response: { 200: z.array(projectSchema) },
      },
    },
    async (request) => {
      const auth = requireAuth(request.auth);
      const rows = await app.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, auth.workspaceId),
            request.query.includeArchived === 'true' ? undefined : isNull(projects.archivedAt),
          ),
        )
        .orderBy(asc(projects.position), asc(projects.createdAt));
      return rows.map(toProject);
    },
  );

  app.post(
    '/projects',
    { schema: { body: projectCreateSchema, response: { 201: projectSchema } } },
    async (request, reply) => {
      const auth = requireAuth(request.auth);
      const project = await app.db.transaction(async (tx) => {
        const [{ next }] = (await tx
          .select({ next: sql<number>`coalesce(max(${projects.position}) + 1, 0)::int` })
          .from(projects)
          .where(eq(projects.workspaceId, auth.workspaceId))) as [{ next: number }];
        const [created] = await tx
          .insert(projects)
          .values({
            workspaceId: auth.workspaceId,
            name: request.body.name,
            description: request.body.description ?? null,
            color: request.body.color ?? null,
            position: next,
            createdBy: auth.userId,
          })
          .returning();
        // Every list starts with one section so tasks always have a home.
        await tx.insert(sections).values({
          workspaceId: auth.workspaceId,
          projectId: created!.id,
          name: 'Tasks',
          createdBy: auth.userId,
        });
        return created!;
      });
      return reply.status(201).send(toProject(project));
    },
  );

  app.patch(
    '/projects/:id',
    { schema: { params: idParams, body: projectUpdateSchema, response: { 200: projectSchema } } },
    async (request) => {
      const auth = requireAuth(request.auth);
      const { revision, archived, position, ...fields } = request.body;
      return app.db.transaction(async (tx) => {
        const current = await getProject(tx, auth, request.params.id);
        if (current.revision !== revision) throw staleRevision();
        if (position !== undefined && position !== current.position) {
          const siblings = await tx
            .select({ id: projects.id, position: projects.position })
            .from(projects)
            .where(and(eq(projects.workspaceId, auth.workspaceId), isNull(projects.archivedAt)))
            .orderBy(asc(projects.position), asc(projects.createdAt));
          const order = placeAt(
            siblings.map((row) => row.id),
            current.id,
            position,
          );
          for (const change of changedPositions(siblings, order)) {
            if (change.id === current.id) continue;
            await tx
              .update(projects)
              .set({ position: change.position })
              .where(eq(projects.id, change.id));
          }
        }
        const [updated] = await tx
          .update(projects)
          .set({
            ...fields,
            ...(position !== undefined ? { position } : {}),
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
            revision: current.revision + 1,
            updatedBy: auth.userId,
            updatedAt: new Date(),
          })
          .where(eq(projects.id, current.id))
          .returning();
        return toProject(updated!);
      });
    },
  );

  app.post(
    '/projects/:id/sections',
    { schema: { params: idParams, body: sectionCreateSchema, response: { 201: sectionSchema } } },
    async (request, reply) => {
      const auth = requireAuth(request.auth);
      const project = await getProject(app.db, auth, request.params.id);
      const [{ next }] = (await app.db
        .select({ next: sql<number>`coalesce(max(${sections.position}) + 1, 0)::int` })
        .from(sections)
        .where(eq(sections.projectId, project.id))) as [{ next: number }];
      const [created] = await app.db
        .insert(sections)
        .values({
          workspaceId: auth.workspaceId,
          projectId: project.id,
          name: request.body.name,
          position: next,
          createdBy: auth.userId,
        })
        .returning();
      return reply.status(201).send(toSection(created!));
    },
  );

  app.patch(
    '/sections/:id',
    { schema: { params: idParams, body: sectionUpdateSchema, response: { 200: sectionSchema } } },
    async (request) => {
      const auth = requireAuth(request.auth);
      const { revision, archived, position, name } = request.body;
      return app.db.transaction(async (tx) => {
        const current = await getSection(tx, auth, request.params.id);
        if (current.revision !== revision) throw staleRevision();
        if (position !== undefined && position !== current.position) {
          const siblings = await tx
            .select({ id: sections.id, position: sections.position })
            .from(sections)
            .where(and(eq(sections.projectId, current.projectId), isNull(sections.archivedAt)))
            .orderBy(asc(sections.position), asc(sections.createdAt));
          const order = placeAt(
            siblings.map((row) => row.id),
            current.id,
            position,
          );
          for (const change of changedPositions(siblings, order)) {
            if (change.id === current.id) continue;
            await tx
              .update(sections)
              .set({ position: change.position })
              .where(eq(sections.id, change.id));
          }
        }
        const [updated] = await tx
          .update(sections)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(position !== undefined ? { position } : {}),
            ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}),
            revision: current.revision + 1,
            updatedBy: auth.userId,
            updatedAt: new Date(),
          })
          .where(eq(sections.id, current.id))
          .returning();
        return toSection(updated!);
      });
    },
  );
};
