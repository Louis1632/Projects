import { createHmac, randomBytes } from 'node:crypto';

/** A URL-safe opaque token with 256 bits of entropy. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Tokens are stored as keyed hashes so a database leak alone does not yield usable
 * session cookies or invite links.
 */
export function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex');
}
