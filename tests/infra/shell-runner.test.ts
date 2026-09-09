import { describe, expect, it } from 'vitest';
import { ShellRunner } from '../../src/infra/shell-runner.js';

describe('ShellRunner env injection', () => {
  it('merges injected variables over the process environment instead of replacing it', () => {
    const runner = new ShellRunner();
    const script = 'console.log(process.env.SHELL_RUNNER_TEST_INJECTED, typeof process.env.PATH)';
    const result = runner.run(process.execPath, ['-e', script], {
      env: { SHELL_RUNNER_TEST_INJECTED: 'present' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('present string');
  });

  it('keeps the inherited environment when no variables are injected', () => {
    const runner = new ShellRunner();
    const result = runner.run(process.execPath, ['-e', 'console.log(typeof process.env.PATH)']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('string');
  });
});
