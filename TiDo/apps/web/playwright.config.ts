import { defineConfig, devices } from '@playwright/test';

export const E2E = {
  databaseUrl: process.env.E2E_DATABASE_URL ?? 'postgresql://tido:tido@localhost:5432/tido_e2e',
  apiPort: 3100,
  webPort: 5174,
  sessionSecret: 'e2e-session-secret-that-is-long-enough-123',
};
const webOrigin = `http://localhost:${E2E.webPort}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: webOrigin,
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: [
    {
      command: 'pnpm --filter @tido/api exec node --import tsx src/server.ts',
      url: `http://localhost:${E2E.apiPort}/healthz`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'test',
        DATABASE_URL: E2E.databaseUrl,
        API_PORT: String(E2E.apiPort),
        WEB_ORIGIN: webOrigin,
        SESSION_SECRET: E2E.sessionSecret,
        LOG_LEVEL: 'warn',
        LOGIN_RATE_LIMIT_MAX: '1000',
        RATE_LIMIT_MAX: '100000',
      },
    },
    {
      command: `pnpm exec vite --port ${E2E.webPort} --strictPort`,
      url: webOrigin,
      reuseExistingServer: false,
      env: { TIDO_API_URL: `http://localhost:${E2E.apiPort}` },
    },
  ],
});
