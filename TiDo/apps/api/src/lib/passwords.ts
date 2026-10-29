import { hash, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1.
const options = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. With no stored hash, a dummy hash is still checked so the response
 * time does not reveal whether an account exists.
 */
export async function verifyPassword(
  storedHash: string | null,
  password: string,
): Promise<boolean> {
  if (!storedHash) {
    dummyHash ??= hashPassword('tido-dummy-password-for-timing');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(storedHash, password).catch(() => false);
}
