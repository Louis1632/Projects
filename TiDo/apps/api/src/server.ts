import { createDb } from '@tido/db';
import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const { db, close } = createDb(config.databaseUrl);
const app = await buildApp({ config, db });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await close();
    process.exit(0);
  });
}

await app.listen({ host: config.host, port: config.port });
