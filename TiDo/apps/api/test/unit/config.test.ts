import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const base = {
  DATABASE_URL: 'postgresql://localhost/tido',
  WEB_ORIGIN: 'http://localhost:5173/',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
  it('applies defaults and normalises the origin', () => {
    const config = loadConfig(base);
    expect(config.webOrigin).toBe('http://localhost:5173');
    expect(config.workspaceTimezone).toBe('Africa/Johannesburg');
    expect(config.cookieSecure).toBe(false);
    expect(config.docs).toBe(true);
  });

  it('rejects short secrets and insecure __Host- cookies', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...base, SESSION_COOKIE_NAME: '__Host-tido' })).toThrow(
      /COOKIE_SECURE/,
    );
  });

  it('refuses the example secret in production', () => {
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        SESSION_SECRET: 'replace-with-a-random-32-byte-secret',
      }),
    ).toThrow(/real secret/);
  });
});
