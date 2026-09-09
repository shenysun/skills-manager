export type GitLogEntry = {
  hash: string;
  timestamp: string;
  subject: string;
};

export type GitCloneOptions = {
  /** Ref to land HEAD on — branch, tag, or full commit SHA; the adapter discriminates and maps to CLI args. */
  ref?: string;
  /** Commit-history depth to fetch; defaults to 1 (shallow transport, ADR-0013). */
  depth?: number;
};

export interface GitPort {
  /** Shallow-clone `repoUrl` into `destination`, leaving HEAD on `options.ref` when given. */
  clone(repoUrl: string, destination: string, options?: GitCloneOptions): void;
  revParseHead(repoDir: string): string;
  listRemoteHeads(repoUrl: string): string[];
  statusShort(cwd: string): string;
  log(cwd: string, maxCount: number): GitLogEntry[];
}
