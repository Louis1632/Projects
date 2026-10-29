import { createHmac, hkdfSync, randomBytes } from 'node:crypto';

/** A URL-safe opaque token with 256 bits of entropy. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** What a token is for. Each purpose gets its own key, so one kind can never pass as another. */
export type TokenPurpose = 'session' | 'account-link';

const keys = new Map<string, Buffer>();

function keyFor(secret: string, purpose: TokenPurpose): Buffer {
  const cacheKey = `${purpose}\0${secret}`;
  let key = keys.get(cacheKey);
  if (!key) {
    key = Buffer.from(hkdfSync('sha256', secret, '', `tido:${purpose}`, 32));
    keys.set(cacheKey, key);
  }
  return key;
}

/**
 * Tokens are stored as keyed hashes so a database leak alone does not yield usable
 * session cookies or invite links. The key is derived from the secret per purpose.
 */
export function hashToken(token: string, secret: string, purpose: TokenPurpose): string {
  return createHmac('sha256', keyFor(secret, purpose)).update(token).digest('hex');
}
