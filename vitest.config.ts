import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'dashboard-web/src/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    coverage: {
      provider: 'v8',
      // Runtime code only — tests and fixtures are the instrument, not the target.
      // .vue SFCs are excluded: the v8 provider cannot parse them (rolldown
      // rejects SFC syntax) and they are silently dropped anyway — see ticket 09.
      include: ['src/**/*.{js,ts}', 'dashboard-web/src/**/*.{js,ts}'],
      reporter: ['text', 'json-summary', 'clover'],
      // Anti-regression floor at today's baseline (full-inventory counting):
      // lines 77.66 / functions 76.99 / statements 74.41. The spec's ≥80% is
      // not met yet — the gap is zero-tested CLI entry code (src/cli/main.ts,
      // bootstrap), raised to the 80 gate by follow-up ticket 10. Branches
      // (~66%) stay ungated for the same reason.
      thresholds: { statements: 74, functions: 76, lines: 77 },
    },
  },
});
