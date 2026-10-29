import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { bootstrapOwner, createDb, runMigrations } from '@tido/db';
import { E2E } from '../playwright.config';

const here = path.dirname(fileURLToPath(import.meta.url));
export const setupFile = path.join(here, '.state', 'setup.json');

/** Fresh database, migrations, and a one-time owner setup link for the specs. */
export default async function globalSetup() {
  const url = new URL(E2E.databaseUrl);
  const name = url.pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error(`Refusing to reset ${name}`);
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
  await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  await admin.end();

  await runMigrations(E2E.databaseUrl, path.resolve(here, '../../../packages/db/drizzle'));
  const { db, close } = createDb(E2E.databaseUrl, { max: 1 });
  const link = await bootstrapOwner(db, {
    email: 'owner@example.test',
    displayName: 'Olive Owner',
    workspaceName: 'Home',
    timezone: 'Africa/Johannesburg',
    tokenSecret: E2E.sessionSecret,
    webOrigin: `http://localhost:${E2E.webPort}`,
  });
  await close();
  mkdirSync(path.dirname(setupFile), { recursive: true });
  writeFileSync(setupFile, JSON.stringify({ ownerSetupUrl: link.url }));
}
