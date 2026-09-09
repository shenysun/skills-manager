import { spawnSync } from 'node:child_process';
import type { ProcessRunOptions, ProcessRunnerPort, ProcessRunResult } from '../core/ports/process-runner.js';

/** Raised when a command exceeds its `timeoutMs` budget and is killed — distinct from a
 *  non-zero exit so callers can tell "stalled transport" from "git answered no". */
export class CommandTimeoutError extends Error {
  constructor(
    command: string,
    args: string[],
    readonly timeoutMs: number,
  ) {
    super(`Command timed out after ${timeoutMs}ms and was killed: ${command} ${args.join(' ')}`);
    this.name = 'CommandTimeoutError';
  }
}

export class ShellRunner implements ProcessRunnerPort {
  run(command: string, args: string[], options: ProcessRunOptions = {}): ProcessRunResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, ...options.env },
      ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    });
    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      ...(result.signal ? { signal: result.signal } : {}),
    };
  }

  runOrThrow(command: string, args: string[], options: ProcessRunOptions = {}) {
    const result = this.run(command, args, options);
    if (result.status === null && result.signal) throw new CommandTimeoutError(command, args, options.timeoutMs ?? 0);
    if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }
}
