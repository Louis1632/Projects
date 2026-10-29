import type { Database } from '@tido/db';
import type { Role } from '@tido/contracts';
import type { Config } from './config';

export interface AuthContext {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  workspaceId: string;
  workspaceName: string;
  timezone: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
  }
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** Reachable without a session. Every other /api route requires sign-in. */
    public?: boolean;
    /** Restricted to workspace owners. */
    ownerOnly?: boolean;
  }
}

/** Narrows `request.auth` inside handlers that the auth hook already protected. */
export function requireAuth(auth: AuthContext | null): AuthContext {
  if (!auth) throw new Error('Route handler reached without an authenticated session');
  return auth;
}
