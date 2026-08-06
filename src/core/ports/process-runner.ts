export type ProcessRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

export interface ProcessRunnerPort {
  run(command: string, args: string[], options?: { cwd?: string }): ProcessRunResult;
}
