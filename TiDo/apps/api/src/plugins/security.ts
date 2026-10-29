import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const securityPlugin = fp(async (app: FastifyInstance) => {
  await app.register(helmet, {
    // The API only serves JSON; the web container sets the page CSP.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    hsts: app.config.cookieSecure,
  });

  await app.register(rateLimit, {
    global: true,
    max: app.config.rateLimitMax,
    timeWindow: '1 minute',
  });

  // CSRF defence: cookies are SameSite=Lax, and every state-changing request must carry a
  // custom header (which cross-site forms cannot send and cross-origin fetches cannot send
  // without a CORS preflight we never grant) and, when present, a matching Origin.
  app.addHook('onRequest', async (request) => {
    if (SAFE_METHODS.has(request.method) || !request.url.startsWith('/api/')) return;
    const origin = request.headers.origin;
    if (origin && origin !== app.config.webOrigin) {
      throw new AppError(403, 'csrf_failed', 'This request was blocked for your security.');
    }
    if (request.headers['x-csrf-request'] !== '1') {
      throw new AppError(403, 'csrf_failed', 'This request was blocked for your security.');
    }
  });
});
