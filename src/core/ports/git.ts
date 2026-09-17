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
  /** Tree SHA of `subpath` at HEAD (`HEAD:<subpath>^{tree}`); works on a shallow clone (ADR-0013). */
  revParseTree(repoDir: string, subpath: string): string;
  listRemoteHeads(repoUrl: string): string[];
  /** Best-effort `git status --short`: empty on any git failure (existing consumers treat that as "not a repo"). */
  statusShort(cwd: string): string;
  log(cwd: string, maxCount: number): GitLogEntry[];

  // Hub sync plumbing (ADR-0020): repo-local git operations on the hub itself.
  // No third-party tools, no shelling out beyond system git — `available()` is
  // the preflight that keeps a missing git a clean error instead of spawn noise.

  /** Whether system git answers at all; false on a missing binary. */
  available(): boolean;
  /** `git init` in `cwd` (idempotent at git's own level, but callers detect adoption first). */
  initRepo(cwd: string): void;
  /** The URL remote `name` points at, or null when the remote is not configured. */
  remoteUrl(cwd: string, name: string): string | null;
  remoteAdd(cwd: string, name: string, url: string): void;
  /** `git status --porcelain -uall` output (untracked directories expanded to
   *  individual files, so a line count is an honest file count); empty when
   *  the tree is clean. Unlike `statusShort` this is strict — a git failure
   *  throws, because sync must never mistake "git answered no" for "clean
   *  tree". */
  statusPorcelain(cwd: string): string;
  /** Stage everything (`git add -A`). */
  addAll(cwd: string): void;
  /** Create a commit with `message`; returns the new HEAD's full SHA. */
  commit(cwd: string, message: string): string;
  /** Commits HEAD is ahead of / behind its upstream (remote-tracking ref) — a
   *  purely local read off the last fetch, never a network round-trip. Null
   *  when the upstream cannot be resolved (none configured, or an unborn
   *  HEAD); any other git failure throws (strict — a broken repo must not
   *  masquerade as "no upstream"). */
  aheadBehind(cwd: string): { ahead: number; behind: number } | null;
}
