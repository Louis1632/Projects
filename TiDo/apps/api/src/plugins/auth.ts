import cookie from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { forbidden, unauthenticated } from '../errors';
import { resolveSession, type NewSession } from '../modules/auth/sessions';

export const authPlugin = fp(async (app: FastifyInstance) => {
  await app.register(cookie);
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[app.config.sessionCookieName];
    if (token && token.length <= 256) {
      request.auth = await resolveSession(app.db, app.config.sessionSecret, token);
    }
    // Secure by default: every API route needs a session unless it opts out.
    if (!request.url.startsWith('/api/')) return;
    const routeConfig = request.routeOptions.config;
    if (routeConfig?.public) return;
    if (!request.auth) throw unauthenticated();
    if (routeConfig?.ownerOnly && request.auth.role !== 'owner') throw forbidden();
  });
});

export function setSessionCookie(app: FastifyInstance, reply: FastifyReply, session: NewSession) {
  reply.setCookie(app.config.sessionCookieName, session.token, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });
}

export function clearSessionCookie(app: FastifyInstance, reply: FastifyReply) {
  reply.clearCookie(app.config.sessionCookieName, {
    httpOnly: true,
    secure: app.config.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}
