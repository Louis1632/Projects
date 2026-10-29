import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { calendarQuerySchema, dashboardSchema, taskSchema, type Dashboard } from '@tido/contracts';
import { projects, sections, tasks, type Executor } from '@tido/db';
import { addDays, todayIn } from '../../lib/dates';
import { requireAuth, type AuthContext } from '../../types';
import { listLabels } from '../labels/routes';
import { listMembers } from '../members/routes';
import { toProject, toSection } from '../projects/routes';
import { ensureGenerated, HORIZON_DAYS } from '../recurrence/service';
import { hydrateTasks, listedTaskCondition, sectionOrder } from '../tasks/core';

/** Everything the list view needs in one round trip. */
export async function buildDashboard(exec: Executor, auth: AuthContext): Promise<Dashboard> {
  const today = todayIn(auth.timezone);
  await ensureGenerated(exec, auth.workspaceId, addDays(today, HORIZON_DAYS), today);

  const projectRows = await exec
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, auth.workspaceId), isNull(projects.archivedAt)))
    .orderBy(asc(projects.position), asc(projects.createdAt));
  const projectIds = projectRows.map((row) => row.id);
  const sectionRows = projectIds.length
    ? await exec
        .select()
        .from(sections)
        .where(and(inArray(sections.projectId, projectIds), isNull(sections.archivedAt)))
        .orderBy(asc(sections.position), asc(sections.createdAt))
    : [];

  const taskRows = await exec
    .select()
    .from(tasks)
    .where(listedTaskCondition(exec, auth.workspaceId))
    .orderBy(...sectionOrder);
  const hydrated = await hydrateTasks(exec, taskRows);

  return {
    projects: projectRows.map((project) => ({
      ...toProject(project),
      sections: sectionRows
        .filter((section) => section.projectId === project.id)
        .map((section) => ({
          ...toSection(section),
          tasks: hydrated.filter((task) => task.sectionId === section.id),
        })),
    })),
    members: await listMembers(exec, auth.workspaceId),
    labels: await listLabels(exec, auth.workspaceId),
  };
}

export const dashboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/dashboard', { schema: { response: { 200: dashboardSchema } } }, async (request) =>
    buildDashboard(app.db, requireAuth(request.auth)),
  );

  app.get(
    '/calendar',
    { schema: { querystring: calendarQuerySchema, response: { 200: z.array(taskSchema) } } },
    async (request) => {
      const auth = requireAuth(request.auth);
      const { from, to, projectId, assigneeId } = request.query;
      const today = todayIn(auth.timezone);
      await ensureGenerated(app.db, auth.workspaceId, to, today);
      const rows = await app.db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.workspaceId, auth.workspaceId),
            isNull(tasks.parentTaskId),
            isNull(tasks.archivedAt),
            projectId ? eq(tasks.projectId, projectId) : undefined,
            assigneeId ? eq(tasks.assigneeId, assigneeId) : undefined,
            or(
              and(gte(tasks.dueDate, from), lte(tasks.dueDate, to)),
              and(isNull(tasks.dueDate), gte(tasks.startDate, from), lte(tasks.startDate, to)),
            ),
          ),
        )
        .orderBy(sql`coalesce(${tasks.dueDate}, ${tasks.startDate})`, asc(tasks.position))
        .limit(2_000);
      return hydrateTasks(app.db, rows);
    },
  );
};
