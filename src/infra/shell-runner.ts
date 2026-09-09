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
      ...(result.error ? { spawnError: { code: (result.error as NodeJS.ErrnoException).code, message: result.error.message } } : {}),
    };
  }

  runOrThrow(command: string, args: string[], options: ProcessRunOptions = {}) {
    const result = this.run(command, args, options);
    if (result.status === null && result.signal) {
      // Only a spawnSync timeout (ETIMEDOUT) is a real budget kill; any other
      // signal death — OOM killer, external kill — must not be sold as one
      // (adversary M1).
      if (result.spawnError?.code === 'ETIMEDOUT') {
        throw new CommandTimeoutError(command, args, options.timeoutMs ?? 0);
      }
      throw new Error(`Command killed by signal ${result.signal}: ${command} ${args.join(' ')}`);
    }
    if (result.status !== 0) {
      const cause = result.stderr || result.stdout || (result.spawnError ? `${result.spawnError.code ?? ''} ${result.spawnError.message}` : '');
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n${cause}`);
    }
    return result.stdout.trim();
  }
}
