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

  it('accepts a boolean or a hop count for TRUST_PROXY', () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base, TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: '2' }).trustProxy).toBe(2);
    expect(() => loadConfig({ ...base, TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/);
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
