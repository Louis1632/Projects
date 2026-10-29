import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { accountTokens, generateToken, hashToken, users, type Executor } from '@tido/db';
import type { AccountLink } from '@tido/contracts';

const TTL_MS = { invite: 7 * 24 * 3_600_000, password_reset: 24 * 3_600_000 } as const;
const PATHS = { invite: 'invite', password_reset: 'reset' } as const;

type Kind = keyof typeof TTL_MS;

/** Issues a single-use link and revokes any earlier unused link for the same person. */
export async function issueAccountLink(
  exec: Executor,
  options: { secret: string; webOrigin: string; userId: string; kind: Kind; createdBy: string },
): Promise<AccountLink> {
  await exec
    .update(accountTokens)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(accountTokens.userId, options.userId),
        isNull(accountTokens.usedAt),
        isNull(accountTokens.revokedAt),
      ),
    );

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_MS[options.kind]);
  await exec.insert(accountTokens).values({
    userId: options.userId,
    kind: options.kind,
    tokenHash: hashToken(token, options.secret),
    createdBy: options.createdBy,
    expiresAt,
  });
  return {
    url: `${options.webOrigin}/${PATHS[options.kind]}/${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function findUsableToken(exec: Executor, secret: string, token: string) {
  const [row] = await exec
    .select({
      id: accountTokens.id,
      kind: accountTokens.kind,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
      isActive: users.isActive,
    })
    .from(accountTokens)
    .innerJoin(users, eq(users.id, accountTokens.userId))
    .where(
      and(
        eq(accountTokens.tokenHash, hashToken(token, secret)),
        isNull(accountTokens.usedAt),
        isNull(accountTokens.revokedAt),
        gt(accountTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row && row.isActive ? row : undefined;
}

export async function markTokenUsed(exec: Executor, tokenId: string): Promise<boolean> {
  const updated = await exec
    .update(accountTokens)
    .set({ usedAt: sql`now()` })
    .where(and(eq(accountTokens.id, tokenId), isNull(accountTokens.usedAt)))
    .returning({ id: accountTokens.id });
  return updated.length === 1;
}
