import { defineConfig } from 'vite';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  publicDir: 'public',
  build: {
    target: 'chrome120',
    outDir: 'dist',
    emptyOutDir: true,
    rolldownOptions: {
      onwarn(warning, defaultHandler) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) {
          return;
        }
        defaultHandler(warning);
      },
      input: {
        popup: resolve('popup.html'),
        dashboard: resolve('dashboard.html'),
        background: resolve('background.js'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    {
      name: 'extension-assets',
      generateBundle() {
        for (const name of [
          'LICENSE',
          'manifest.json',
          'THIRD_PARTY_NOTICES.txt',
          ...readdirSync('icons').map((name) => 'icons/' + name),
        ]) {
          this.emitFile({ type: 'asset', fileName: name, source: readFileSync(name) });
        }
      },
    },
  ],
});
