import { spawnSync } from 'node:child_process';
import type { ProcessRunOptions, ProcessRunnerPort, ProcessRunResult } from '../core/ports/process-runner.js';

export class ShellRunner implements ProcessRunnerPort {
  run(command: string, args: string[], options: ProcessRunOptions = {}): ProcessRunResult {
    const result = spawnSync(command, args, {
      cwd: options.cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, ...options.env },
    });
    return {
      status: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }

  runOrThrow(command: string, args: string[], options: ProcessRunOptions = {}) {
    const result = this.run(command, args, options);
    if (result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
    return result.stdout.trim();
  }
}
