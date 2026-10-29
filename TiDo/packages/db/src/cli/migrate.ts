import { fileURLToPath } from 'node:url';
import { runMigrations } from '../migrate';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const folder = fileURLToPath(new URL('../../drizzle', import.meta.url));
await runMigrations(databaseUrl, folder);
console.log('Migrations applied.');
