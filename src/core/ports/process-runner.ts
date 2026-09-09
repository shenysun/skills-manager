export type ProcessRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export type ProcessRunOptions = {
  cwd?: string;
  /** Extra environment variables merged over the process environment (PATH etc. stay intact). */
  env?: Record<string, string>;
};

export interface ProcessRunnerPort {
  run(command: string, args: string[], options?: ProcessRunOptions): ProcessRunResult;
}
