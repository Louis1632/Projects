import { createServer, type Server } from 'node:http';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Histogram, type Registry } from 'prom-client';

// Request duration per route, the source of the RED (rate, errors, duration) dashboards.
// `route` is the route pattern (/api/v1/tasks/:id), never the raw URL, so label values stay few.
export const metricsPlugin = fp<{ registry: Registry }>(async (app: FastifyInstance, options) => {
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route pattern and status code.',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [options.registry],
  });

  // Timed here rather than with reply.elapsed, which is NaN unless request logging is on.
  const started = new WeakMap<object, number>();
  app.addHook('onRequest', async (request) => {
    started.set(request, performance.now());
  });
  app.addHook('onResponse', async (request, reply) => {
    const start = started.get(request);
    if (start === undefined) return;
    duration.observe(
      {
        method: request.method,
        route: request.routeOptions.url ?? 'unmatched',
        status_code: String(reply.statusCode),
      },
      (performance.now() - start) / 1000,
    );
  });
});

// Serves /metrics on its own port so it never passes through the ingress, auth or rate limits.
// Only Prometheus (allowed by NetworkPolicy) can reach it in the cluster.
export function startMetricsServer(registry: Registry, host: string, port: number): Server {
  const server = createServer((request, response) => {
    if (request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    registry.metrics().then(
      (body) => response.writeHead(200, { 'content-type': registry.contentType }).end(body),
      () => response.writeHead(500).end(),
    );
  });
  server.listen(port, host);
  return server;
}
