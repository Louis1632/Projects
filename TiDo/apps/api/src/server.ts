import { createDb } from '@tido/db';
import { collectDefaultMetrics, Registry } from 'prom-client';
import { buildApp } from './app';
import { loadConfig } from './config';
import { startMetricsServer } from './plugins/metrics';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const metricsRegistry = new Registry();
// Process metrics: CPU, memory, heap, event-loop lag, GC, open handles.
collectDefaultMetrics({ register: metricsRegistry });
const app = await buildApp({ config, db, metricsRegistry });
const metricsServer =
  config.metricsPort === undefined
    ? undefined
    : startMetricsServer(metricsRegistry, config.host, config.metricsPort);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    metricsServer?.close();
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
