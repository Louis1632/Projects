import Fastify from 'fastify';
import { Registry } from 'prom-client';
import { afterEach, describe, expect, it } from 'vitest';
import { metricsPlugin, startMetricsServer } from '../../src/plugins/metrics';

describe('metricsPlugin', () => {
  let close: (() => void) | undefined;
  afterEach(() => close?.());

  it('records duration by route pattern, not raw URL', async () => {
    const registry = new Registry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });
    app.get('/items/:id', async () => ({ ok: true }));

    await app.inject('/items/42');
    await app.inject('/missing');

    const text = await registry.metrics();
    expect(text).toContain(
      'http_request_duration_seconds_count{method="GET",route="/items/:id",status_code="200"} 1',
    );
    expect(text).toContain('route="unmatched",status_code="404"');
    expect(text).not.toContain('/items/42');
  });

  it('serves the registry on /metrics only', async () => {
    const registry = new Registry();
    const server = startMetricsServer(registry, '127.0.0.1', 0);
    close = () => server.close();
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address() as { port: number };

    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get('content-type')).toContain('text/plain');
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
  });
});
