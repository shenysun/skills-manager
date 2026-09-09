import { describe, expect, it } from 'vitest';
import { CommandTimeoutError, ShellRunner } from '../../src/infra/shell-runner.js';

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

describe('ShellRunner timeout (ticket 08)', () => {
  // Real process, not a fake: the spawnSync timeout/kill contract (status null +
  // SIGTERM) is exactly what this ticket exists to rely on — asserting it against
  // a hand-rolled result object would test nothing.
  it('kills a command that exceeds timeoutMs and reports status null with the kill signal', () => {
    const runner = new ShellRunner();
    const result = runner.run(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 });
    expect(result.status).toBeNull();
    expect(result.signal).toBe('SIGTERM');
  });

  it('runOrThrow raises a CommandTimeoutError naming the timeout and the command', () => {
    const runner = new ShellRunner();
    expect(() =>
      runner.runOrThrow(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 }),
    ).toThrow(CommandTimeoutError);
    try {
      runner.runOrThrow(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 100 });
    } catch (error) {
      expect((error as CommandTimeoutError).timeoutMs).toBe(100);
      expect((error as Error).message).toContain('timed out after 100ms');
    }
  });

  it('leaves a command that finishes within timeoutMs alone', () => {
    const runner = new ShellRunner();
    const result = runner.run(process.execPath, ['-e', 'console.log("done")'], { timeoutMs: 5000 });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('done');
  });
});

describe('ShellRunner kill-source discrimination (adversary M1/L10)', () => {
  it('reports an external signal kill as a signal failure, not a timeout', () => {
    const runner = new ShellRunner();
    let thrown: unknown;
    try {
      runner.runOrThrow(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")']);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).not.toBeInstanceOf(CommandTimeoutError);
    expect((thrown as Error).message).toContain('SIGKILL');
  });

  it('explains a missing command instead of an empty failure (ENOENT)', () => {
    const runner = new ShellRunner();
    expect(() => runner.runOrThrow('definitely-not-a-command-xyz', [])).toThrow(/not a command|ENOENT|spawn/i);
  });
});
