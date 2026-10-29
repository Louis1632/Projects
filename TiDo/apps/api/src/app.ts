import { randomUUID } from 'node:crypto';
import type FastifyOtelInstrumentation from '@fastify/otel';
import Fastify, { type FastifyServerOptions } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { sql } from 'drizzle-orm';
import { Registry } from 'prom-client';
import type { Database } from '@tido/db';
import type { Config } from './config';
import { authRoutes } from './modules/auth/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { labelRoutes } from './modules/labels/routes';
import { memberRoutes } from './modules/members/routes';
import { projectRoutes } from './modules/projects/routes';
import { taskRoutes } from './modules/tasks/routes';
import { authPlugin } from './plugins/auth';
import { errorsPlugin } from './plugins/errors';
import { metricsPlugin } from './plugins/metrics';
import { securityPlugin } from './plugins/security';
import { traceLogFields } from './telemetry';
import './types';

export interface BuildAppOptions {
  config: Config;
  db: Database;
  logger?: FastifyServerOptions['logger'];
  metricsRegistry?: Registry;
  tracing?: FastifyOtelInstrumentation;
}

export async function buildApp({ config, db, logger, metricsRegistry, tracing }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? {
      level: config.logLevel,
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      mixin: traceLogFields,
    },
    trustProxy: config.trustProxy,
    genReqId: () => randomUUID(),
    bodyLimit: 256 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  app.decorate('db', db);

  // First, so it wraps every later plugin, hook and route.
  if (tracing) await app.register(tracing.plugin());
  await app.register(metricsPlugin, { registry: metricsRegistry ?? new Registry() });
  await app.register(errorsPlugin);
  await app.register(securityPlugin);
  await app.register(authPlugin);

  if (config.docs) {
    const [{ default: swagger }, { default: swaggerUi }] = await Promise.all([
      import('@fastify/swagger'),
      import('@fastify/swagger-ui'),
    ]);
    await app.register(swagger, {
      openapi: { info: { title: 'TiDo API', version: '0.1.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  app.get('/healthz', { logLevel: 'warn' }, async () => ({ status: 'ok' }));
  app.get('/readyz', { logLevel: 'warn' }, async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch {
      return reply.status(503).send({ status: 'database unavailable' });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(memberRoutes);
      await api.register(projectRoutes);
      await api.register(labelRoutes);
      await api.register(taskRoutes);
      await api.register(dashboardRoutes);
    },
    { prefix: '/api/v1' },
  );

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
