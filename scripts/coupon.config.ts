import { defineConfig } from 'vitest/config';

// Runs the generator scripts in scripts/ (not part of `npm test`).
export default defineConfig({
  root: decodeURIComponent(new URL('..', import.meta.url).pathname),
  test: { include: ['scripts/*.test.ts'] },
});
