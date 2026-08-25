import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'dashboard-web/src/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
  },
});
