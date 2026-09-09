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
      // CLI entry files run in spawnSync child processes (tests/cli/*.test.ts);
      // the v8 provider cannot see grandchild-process coverage (NODE_V8_COVERAGE
      // output is produced but never merged), so they read as 0% here despite
      // being behavior-asserted by those suites — notably bootstrap.test.ts,
      // cli-bin.test.ts, status-and-reminder.test.ts. Excluded with that
      // evidence recorded in tree-sha ticket 10.
      exclude: ['src/cli/main.ts', 'src/cli/bootstrap.ts', 'src/cli/bootstrap-prompt.ts', '**/node_modules/**'],
      reporter: ['text', 'json-summary', 'clover'],
      // Spec gate (tree-sha-update-pipeline): ≥80% on the primary metrics.
      // Branches sit at ~66% and stay ungated — raising them is future work.
      thresholds: { statements: 80, functions: 80, lines: 80 },
    },
  },
});
