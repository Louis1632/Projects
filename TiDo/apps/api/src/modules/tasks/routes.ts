import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  completionEntrySchema,
  idSchema,
  okSchema,
  taskCompletionSchema,
  taskCreateSchema,
  taskDeleteQuerySchema,
  taskFilterSchema,
  taskMoveSchema,
  taskSchema,
  taskUpdateSchema,
} from '@tido/contracts';
import { todayIn } from '../../lib/dates';
import { requireAuth } from '../../types';
import { loadTask } from './core';
import {
  createTask,
  deleteTask,
  listCompletions,
  listTasks,
  moveTask,
  setCompletion,
  updateTask,
} from './service';

const idParams = z.object({ id: idSchema });

export const taskRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/tasks',
    { schema: { querystring: taskFilterSchema, response: { 200: z.array(taskSchema) } } },
    async (request) => listTasks(app.db, requireAuth(request.auth), request.query),
  );

  app.post(
    '/tasks',
    { schema: { body: taskCreateSchema, response: { 201: taskSchema } } },
    async (request, reply) => {
      const auth = requireAuth(request.auth);
      const task = await createTask(app.db, auth, request.body, todayIn(auth.timezone));
      return reply.status(201).send(task);
    },
  );

  app.get(
    '/tasks/:id',
    { schema: { params: idParams, response: { 200: taskSchema } } },
    async (request) => loadTask(app.db, requireAuth(request.auth), request.params.id),
  );

  app.patch(
    '/tasks/:id',
    { schema: { params: idParams, body: taskUpdateSchema, response: { 200: taskSchema } } },
    async (request) => {
      const auth = requireAuth(request.auth);
      return updateTask(app.db, auth, request.params.id, request.body, todayIn(auth.timezone));
    },
  );

  app.post(
    '/tasks/:id/move',
    { schema: { params: idParams, body: taskMoveSchema, response: { 200: taskSchema } } },
    async (request) => moveTask(app.db, requireAuth(request.auth), request.params.id, request.body),
  );

  app.post(
    '/tasks/:id/completion',
    { schema: { params: idParams, body: taskCompletionSchema, response: { 200: taskSchema } } },
    async (request) =>
      setCompletion(app.db, requireAuth(request.auth), request.params.id, request.body.completed),
  );

  app.get(
    '/tasks/:id/completions',
    { schema: { params: idParams, response: { 200: z.array(completionEntrySchema) } } },
    async (request) => listCompletions(app.db, requireAuth(request.auth), request.params.id),
  );

  app.delete(
    '/tasks/:id',
    {
      schema: { params: idParams, querystring: taskDeleteQuerySchema, response: { 200: okSchema } },
    },
    async (request) => {
      await deleteTask(app.db, requireAuth(request.auth), request.params.id, request.query.scope);
      return { ok: true as const };
    },
  );
};
