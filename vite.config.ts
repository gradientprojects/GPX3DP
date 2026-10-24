/// <reference types="vitest/config" />
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { defineConfig } from 'vite';

// optional dev tool (notes on UI elements, read by Claude) from ~/.claude/skills/ui-feedback; skipped
// when it isn't installed, and never part of a build
const uiFeedback = await import(pathToFileURL(`${homedir()}/.claude/skills/ui-feedback/vite-plugin.js`).href)
  .then((m) => m.default())
  .catch(() => null);

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/GPX3DP/' : '/',
  plugins: [uiFeedback].filter(Boolean),
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
