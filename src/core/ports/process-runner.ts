export type ProcessRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Signal that killed the process when it never exited on its own (spawnSync timeout). */
  signal?: string;
};

export type ProcessRunOptions = {
  cwd?: string;
  /** Extra environment variables merged over the process environment (PATH etc. stay intact). */
  env?: Record<string, string>;
  /** Kill the process and fail after this many milliseconds; unset means no limit. */
  timeoutMs?: number;
};

export interface ProcessRunnerPort {
  run(command: string, args: string[], options?: ProcessRunOptions): ProcessRunResult;
}
