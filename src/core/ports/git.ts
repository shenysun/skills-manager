export type GitLogEntry = {
  hash: string;
  timestamp: string;
  subject: string;
};

export interface GitPort {
  clone(repoUrl: string, destination: string): void;
  checkout(repoDir: string, ref: string): void;
  revParseHead(repoDir: string): string;
  listRemoteHeads(repoUrl: string): string[];
  statusShort(cwd: string): string;
  log(cwd: string, maxCount: number): GitLogEntry[];
}
