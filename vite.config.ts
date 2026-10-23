/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? '/GPX3DP/' : '/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 60000 },
});
