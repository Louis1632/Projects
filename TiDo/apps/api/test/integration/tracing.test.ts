import { Writable } from 'node:stream';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { sql } from 'drizzle-orm';
import { createDb } from '@tido/db';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { startTracing, traceLogFields } from '../../src/telemetry';
import { testDatabaseUrl } from './database-url';
import { ORIGIN } from './helpers';

const exporter = new InMemorySpanExporter();
const tracing = startTracing(exporter, new SimpleSpanProcessor(exporter));
const { db, close } = createDb(testDatabaseUrl, { max: 2 });
afterAll(() => close());

describe('tracing against PostgreSQL', () => {
  it('nests SQL spans under the request and stamps its log lines with the trace id', async () => {
    const lines: Record<string, unknown>[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(JSON.parse(String(chunk)));
        done();
      },
    });
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      WEB_ORIGIN: ORIGIN,
      SESSION_SECRET: 'integration-test-secret-that-is-long-enough',
      API_DOCS: 'false',
    });
    const app = await buildApp({
      config,
      db,
      tracing: tracing.fastify,
      logger: { level: 'info', stream, mixin: traceLogFields },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGIN, 'x-csrf-request': '1' },
      payload: { email: 'nobody@example.test', password: 'not the password' },
    });
    await app.close();
    expect(response.statusCode).toBe(401);

    const spans = exporter.getFinishedSpans();
    const root = spans.find((span) => span.name === 'POST /api/v1/auth/login');
    const traceId = root?.spanContext().traceId;
    const queries = spans.filter((span) => span.attributes['db.system.name'] === 'postgresql');
    // The failed login looks the user up, then writes an audit event.
    expect(queries.map((query) => query.name)).toEqual(
      expect.arrayContaining(['SELECT', 'INSERT']),
    );
    for (const query of queries) {
      expect(query.spanContext().traceId).toBe(traceId);
      expect(JSON.stringify(query.attributes)).not.toContain('nobody@example.test');
    }

    const completed = lines.find((line) => line.msg === 'request completed');
    expect(completed?.trace_id).toBe(traceId);
  });

  it('does not trace queries made outside a request, such as the readiness probe', async () => {
    exporter.reset();
    await db.execute(sql`select 1`);
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});
