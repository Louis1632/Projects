import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError } from '../errors';

interface PostgresError {
  code?: string;
  constraint_name?: string;
}

function postgresError(error: unknown): PostgresError | undefined {
  const candidate = (error as { cause?: unknown })?.cause ?? error;
  if (candidate && typeof candidate === 'object' && 'code' in candidate) {
    return candidate as PostgresError;
  }
  return undefined;
}

export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const send = (status: number, code: string, message: string, details?: unknown) =>
      reply.status(status).send({ error: { code, message, requestId: request.id, details } });

    if (error instanceof AppError) {
      return send(error.statusCode, error.code, error.message, error.details);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return send(400, 'validation_error', 'Some fields need attention.', error.validation);
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error, issues: error.cause.issues }, 'response failed its schema');
      return send(500, 'internal_error', 'Something went wrong. Please try again.');
    }
    if (error.statusCode === 429) {
      return send(429, 'rate_limited', 'Too many requests. Please wait a moment and try again.');
    }
    const pg = postgresError(error);
    if (pg?.code === '23514' || pg?.code === '23503') {
      return send(400, 'constraint_violation', 'That change is not allowed.', {
        constraint: pg.constraint_name,
      });
    }
    if (pg?.code === '23505') {
      return send(409, 'duplicate', 'Something with that name already exists.', {
        constraint: pg.constraint_name,
      });
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return send(error.statusCode, error.code ?? 'bad_request', error.message);
    }
    request.log.error({ err: error }, 'unhandled error');
    return send(500, 'internal_error', 'Something went wrong. Please try again.');
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: { code: 'not_found', message: 'Not found.', requestId: request.id },
    }),
  );
});
