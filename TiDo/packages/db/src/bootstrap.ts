import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
import { generateToken, hashToken } from './tokens';

export class BootstrapError extends Error {}

export interface BootstrapOptions {
  email: string;
  displayName: string;
  workspaceName: string;
  timezone: string;
  tokenSecret: string;
  webOrigin: string;
  /** How long the one-time setup link stays valid. */
  ttlHours?: number;
}

/**
 * Creates the workspace and its first owner exactly once, returning a single-use setup
 * link where the owner chooses their own password. Refuses to run once any owner exists.
 */
export async function bootstrapOwner(
  db: PostgresJsDatabase<typeof schema>,
  options: BootstrapOptions,
): Promise<{ url: string; expiresAt: Date }> {
  const email = options.email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + (options.ttlHours ?? 72) * 3_600_000);
  const token = generateToken();

  await db.transaction(async (tx) => {
    // Serialise concurrent bootstrap attempts.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(746944)`);

    const existingOwner = await tx
      .select({ userId: schema.workspaceMembers.userId })
      .from(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.role, 'owner'))
      .limit(1);
    if (existingOwner.length > 0) {
      throw new BootstrapError(
        'An owner already exists. Ask an owner to issue an invite or password reset link instead.',
      );
    }

    let [workspace] = await tx.select().from(schema.workspaces).limit(1);
    if (!workspace) {
      [workspace] = await tx
        .insert(schema.workspaces)
        .values({ name: options.workspaceName, timezone: options.timezone })
        .returning();
    }

    let [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email));
    if (!user) {
      [user] = await tx
        .insert(schema.users)
        .values({ email, displayName: options.displayName })
        .returning();
    }

    await tx
      .insert(schema.workspaceMembers)
      .values({ workspaceId: workspace!.id, userId: user!.id, role: 'owner' })
      .onConflictDoUpdate({
        target: [schema.workspaceMembers.workspaceId, schema.workspaceMembers.userId],
        set: { role: 'owner' },
      });

    await tx.insert(schema.accountTokens).values({
      userId: user!.id,
      kind: user!.passwordHash ? 'password_reset' : 'invite',
      tokenHash: hashToken(token, options.tokenSecret),
      expiresAt,
    });

    await tx.insert(schema.auditEvents).values({
      workspaceId: workspace!.id,
      action: 'workspace.bootstrap',
      targetType: 'user',
      targetId: user!.id,
      metadata: { email },
    });
  });

  const origin = options.webOrigin.replace(/\/+$/, '');
  return { url: `${origin}/invite/${token}`, expiresAt };
}
