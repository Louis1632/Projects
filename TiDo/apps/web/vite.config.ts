/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

// The release version lives in the workspace package.json; the revision identifies the
// exact build (container builds pass TIDO_REVISION, since .git is not in the build context).
const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };

function gitRevision(): string {
  if (process.env.TIDO_REVISION) return process.env.TIDO_REVISION;
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

const build = { version, revision: gitRevision(), builtAt: new Date().toISOString() };

/** Publishes version.json so open tabs can notice when a newer build is deployed. */
const versionFile: Plugin = {
  name: 'tido-version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(build) });
  },
};

export default defineConfig({
  plugins: [react(), versionFile],
  define: { __TIDO_BUILD__: JSON.stringify(build) },
  server: {
    port: 5173,
    proxy: { '/api': process.env.TIDO_API_URL ?? 'http://localhost:3000' },
  },
  preview: {
    port: 4173,
    proxy: { '/api': process.env.TIDO_API_URL ?? 'http://localhost:3000' },
  },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
