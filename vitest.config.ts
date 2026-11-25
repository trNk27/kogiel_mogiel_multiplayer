import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __BUILD__: JSON.stringify({ commit: 'test', builtAt: '2026-01-01T00:00:00.000Z' }) },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
});
