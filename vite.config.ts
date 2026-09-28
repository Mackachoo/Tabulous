import { crx } from '@crxjs/vite-plugin';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import manifest from './src/manifest.ts';

/**
 * CRXJS lists `?script` imports as web_accessible_resources on every site. The
 * injector is registered with chrome.scripting, which doesn't need that, and
 * exposing it would let any page detect Tabulous. Dev builds keep it for HMR.
 */
function dropWebAccessibleResources(): Plugin {
  let outDir = 'dist';
  return {
    name: 'tabulous:drop-web-accessible-resources',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const path = resolve(outDir, 'manifest.json');
      const built = JSON.parse(readFileSync(path, 'utf8'));
      delete built.web_accessible_resources;
      writeFileSync(path, `${JSON.stringify(built, null, 2)}\n`);
    },
  };
}

export default defineConfig({
  plugins: [crx({ manifest }), dropWebAccessibleResources()],
  build: {
    rollupOptions: {
      // The onboarding page isn't referenced from the extension manifest,
      // so it has to be listed as an explicit input.
      input: { onboarding: 'src/onboarding/index.html' },
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
