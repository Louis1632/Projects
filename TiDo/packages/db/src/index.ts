import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export * from './schema';
export { schema };
export { runMigrations } from './migrate';
export { bootstrapOwner, BootstrapError, type BootstrapOptions } from './bootstrap';
export { generateToken, hashToken, type TokenPurpose } from './tokens';

export interface DbOptions {
  /** Maximum pool size; keep small because each API replica holds its own pool. */
  max?: number;
}

export function createDb(databaseUrl: string, options: DbOptions = {}) {
  const client = postgres(databaseUrl, {
    max: options.max ?? 10,
    onnotice: () => {},
  });
  const db = drizzle({ client, schema });
  return { db, client, close: () => client.end({ timeout: 5 }) };
}

export type Database = ReturnType<typeof createDb>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Either the pool or an open transaction; services accept both. */
export type Executor = Database | Transaction;
