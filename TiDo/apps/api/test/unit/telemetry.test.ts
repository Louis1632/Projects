import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { loadConfig } from '../../src/config';
import { startTracing, traceLogFields } from '../../src/telemetry';

const exporter = new InMemorySpanExporter();
const tracing = startTracing(exporter, new SimpleSpanProcessor(exporter));

const config = loadConfig({
  DATABASE_URL: 'postgresql://localhost/unused',
  WEB_ORIGIN: 'http://localhost:5173',
  SESSION_SECRET: 'x'.repeat(32),
});

describe('startTracing', () => {
  afterEach(() => exporter.reset());

  it('names request spans by route and exposes the trace to log lines', async () => {
    // These routes never reach the database.
    const app = await buildApp({
      config,
      db: {} as never,
      tracing: tracing.fastify,
      logger: false,
    });
    app.get('/items/:id', async () => traceLogFields());
    const response = await app.inject('/items/42');
    await app.close();

    const root = exporter.getFinishedSpans().find((span) => !span.parentSpanContext);
    expect(root?.name).toBe('GET /items/:id');
    expect(root?.attributes['http.response.status_code']).toBe(200);
    const fields = response.json<{ trace_id: string; span_id: string }>();
    expect(fields.trace_id).toBe(root?.spanContext().traceId);
    expect(fields.span_id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('skips the health probes', async () => {
    const app = await buildApp({
      config,
      db: {} as never,
      tracing: tracing.fastify,
      logger: false,
    });
    await app.inject('/healthz');
    await app.close();
    expect(exporter.getFinishedSpans()).toEqual([]);
  });

  it('adds nothing to log lines outside a traced request', () => {
    expect(traceLogFields()).toEqual({});
  });
});
