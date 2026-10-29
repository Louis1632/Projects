import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    // Containers set API_HOST=0.0.0.0; local development stays on loopback.
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().min(1),
    WEB_ORIGIN: z.url(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    SESSION_COOKIE_NAME: z.string().default('tido_session'),
    COOKIE_SECURE: booleanString.default(false),
    WORKSPACE_TIMEZONE: z.string().default('Africa/Johannesburg'),
    // true/false, or the number of proxy hops to trust. Trusting a fixed count (Traefik is one hop)
    // stops a client from choosing its own IP with a forged X-Forwarded-For.
    TRUST_PROXY: z
      .union([
        z.enum(['true', 'false']).transform((value) => value === 'true'),
        z.coerce
          .number()
          .int()
          .min(0)
          .max(10)
          .transform((hops) => (hops === 0 ? false : hops)),
      ])
      .default(false),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    API_DOCS: booleanString.optional(),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    // Prometheus /metrics listener; unset means no metrics server.
    METRICS_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    // OTLP/HTTP collector for traces (e.g. Tempo at :4318); unset means no tracing.
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && /replace-with/.test(env.SESSION_SECRET)) {
      context.addIssue({ code: 'custom', path: ['SESSION_SECRET'], message: 'Set a real secret' });
    }
    if (env.SESSION_COOKIE_NAME.startsWith('__Host-') && !env.COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: '__Host- cookies require COOKIE_SECURE=true',
      });
    }
  });

export interface Config {
  env: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  webOrigin: string;
  sessionSecret: string;
  sessionCookieName: string;
  cookieSecure: boolean;
  workspaceTimezone: string;
  trustProxy: boolean | number;
  logLevel: string;
  docs: boolean;
  rateLimitMax: number;
  loginRateLimitMax: number;
  metricsPort: number | undefined;
  otlpEndpoint: string | undefined;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid configuration:\n${problems.join('\n')}`);
  }
  const env = parsed.data;
  return {
    env: env.NODE_ENV,
    host: env.API_HOST,
    port: env.API_PORT,
    databaseUrl: env.DATABASE_URL,
    webOrigin: new URL(env.WEB_ORIGIN).origin,
    sessionSecret: env.SESSION_SECRET,
    sessionCookieName: env.SESSION_COOKIE_NAME,
    cookieSecure: env.COOKIE_SECURE,
    workspaceTimezone: env.WORKSPACE_TIMEZONE,
    trustProxy: env.TRUST_PROXY,
    logLevel: env.LOG_LEVEL,
    docs: env.API_DOCS ?? env.NODE_ENV === 'development',
    rateLimitMax: env.RATE_LIMIT_MAX,
    loginRateLimitMax: env.LOGIN_RATE_LIMIT_MAX,
    metricsPort: env.METRICS_PORT,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, ''),
  };
}
