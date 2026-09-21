import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'apps/mobile/src/**/*.test.ts', 'services/*/src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15_000,
  },
});
