import FastifyOtelInstrumentation from '@fastify/otel';
import {
  isSpanContextValid,
  SpanKind,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api';
import { detectResources, envDetector, resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { PostgresJsPreparedQuery } from 'drizzle-orm/postgres-js';

export interface Tracing {
  /** Register as the first Fastify plugin so every route and hook gets spans. */
  fastify: FastifyOtelInstrumentation;
  /** Flushes buffered spans; call on shutdown. */
  shutdown: () => Promise<void>;
}

// Distributed tracing: one trace per request, with child spans for Fastify hooks, the route
// handler and every SQL query. Kubernetes adds k8s.* attributes through OTEL_RESOURCE_ATTRIBUTES.
export function startTracing(
  exporter: SpanExporter,
  processor: SpanProcessor = new BatchSpanProcessor(exporter),
): Tracing {
  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'tido-api' }).merge(
      detectResources({ detectors: [envDetector] }),
    ),
    spanProcessors: [processor],
  });
  // Installs the global tracer, the async context manager that carries the active span across
  // awaits, and W3C traceparent propagation.
  provider.register();

  instrumentDrizzle(trace.getTracer('tido-db'));
  const fastify = new FastifyOtelInstrumentation({
    ignorePaths: ({ url }) => url === '/healthz' || url === '/readyz',
    // One span per plugin hook buries the handler and SQL spans; keep request → handler → SQL.
    instrumentHooks: false,
    // Name the root span after the route pattern, like the metrics' `route` label.
    requestHook: (span, request) =>
      span.updateName(`${request.method} ${request.routeOptions.url ?? 'unmatched'}`),
  });
  fastify.setTracerProvider(provider);
  return { fastify, shutdown: () => provider.shutdown() };
}

// pino mixin: stamps each log line with the active trace so Grafana can jump from a log line
// to its trace. Empty when tracing is off or outside a request.
export function traceLogFields(): { trace_id?: string; span_id?: string } {
  const spanContext = trace.getActiveSpan()?.spanContext();
  return spanContext && isSpanContextValid(spanContext)
    ? { trace_id: spanContext.traceId, span_id: spanContext.spanId }
    : {};
}

// drizzle-orm 0.45 contains span code but never loads OpenTelemetry, so its queries are traced
// here instead. Only the parameterised SQL is recorded, never the parameter values (which can
// hold password hashes and tokens).
let drizzleInstrumented = false;
function instrumentDrizzle(tracer: Tracer) {
  if (drizzleInstrumented) return;
  drizzleInstrumented = true;
  const prototype = PostgresJsPreparedQuery.prototype;
  for (const method of ['execute', 'all'] as const) {
    const original = prototype[method];
    prototype[method] = function (
      this: PostgresJsPreparedQuery<never>,
      placeholderValues?: Record<string, unknown>,
    ) {
      // Outside a traced request (the readiness probe's `select 1`, startup) a span would
      // become a one-span trace of its own; skip it.
      if (!trace.getActiveSpan()) return original.call(this, placeholderValues);
      const query = (this as unknown as { queryString: string }).queryString;
      const operation = /^\s*(\w+)/.exec(query)?.[1]?.toUpperCase() ?? 'QUERY';
      return tracer.startActiveSpan(
        operation,
        {
          kind: SpanKind.CLIENT,
          attributes: {
            'db.system.name': 'postgresql',
            'db.operation.name': operation,
            'db.query.text': query,
          },
        },
        async (span) => {
          try {
            return await original.call(this, placeholderValues);
          } catch (error) {
            span.recordException(error as Error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
            throw error;
          } finally {
            span.end();
          }
        },
      );
    } as (typeof prototype)[typeof method];
  }
}
