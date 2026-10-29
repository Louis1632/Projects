import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@tido/db';

// In the image, migrations live at /app/drizzle beside /app/dist; MIGRATIONS_DIR overrides.
const here = path.dirname(fileURLToPath(import.meta.url));
const folder = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../../drizzle');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

await runMigrations(databaseUrl, folder);
console.log(`Migrations from ${folder} applied.`);
