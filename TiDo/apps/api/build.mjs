import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workspacePackages = {
  '@tido/contracts': path.join(root, 'packages/contracts/src/index.ts'),
  '@tido/db': path.join(root, 'packages/db/src/index.ts'),
};

// Bundle the API together with its workspace packages (which ship TypeScript source).
// npm dependencies stay external and come from `pnpm deploy --prod` in the image.
await build({
  entryPoints: {
    server: 'src/server.ts',
    'cli/migrate': 'src/cli/migrate.ts',
    'cli/bootstrap-owner': 'src/cli/bootstrap-owner.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  plugins: [
    {
      name: 'workspace-packages',
      setup(context) {
        context.onResolve({ filter: /^@tido\/[a-z-]+$/ }, (args) => {
          const resolved = workspacePackages[args.path];
          return resolved ? { path: resolved } : undefined;
        });
      },
    },
  ],
  logLevel: 'info',
});
