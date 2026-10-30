import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicDir = resolve(process.cwd(), 'public');
const manifest = JSON.parse(readFileSync(resolve(publicDir, 'manifest.json'), 'utf8')) as {
  icons: { src: string }[];
};

describe('web app manifest', () => {
  it('only lists icons that exist', () => {
    for (const icon of manifest.icons) {
      expect(existsSync(resolve(publicDir, `.${icon.src}`)), icon.src).toBe(true);
    }
  });
});
