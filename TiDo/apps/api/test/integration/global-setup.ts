import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { runMigrations } from '@tido/db';
import { testDatabaseUrl } from './database-url';

/** Recreates the test database from scratch and applies the committed migrations. */
export default async function setup() {
  const url = new URL(testDatabaseUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to reset "${name}": test databases must end in _test`);
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  const migrations = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/db/drizzle',
  );
  await runMigrations(testDatabaseUrl, migrations);
}
