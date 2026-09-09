/**
 * Read access to GitHub repository metadata needed for update detection
 * (ADR-0013): one call returns a ref's commit SHA plus the tree SHA of every
 * sub-directory, so callers compare a skill's anchored tree SHA against the
 * upstream one without cloning.
 */

/** Failure kinds callers can branch on; every fetch error surfaces as one of these. */
export type GitHubApiFailureKind =
  | 'network'
  | 'timeout'
  | 'rate_limited'
  | 'not_found'
  | 'api';

/**
 * One recursive tree listing of `owner/repo@ref`.
 *
 * - `commitSha`: the commit the ref resolved to.
 * - `trees`: every sub-directory path (`skills/foo`, `.github/workflows`, …)
 *   mapped to its git tree SHA. The repository root itself is NOT in the map —
 *   GitHub's recursive tree endpoint reports the resolved commit SHA, not the
 *   root tree SHA, so root-anchored entries must compare `commitSha` instead.
 */
/** Frozen at the adapter — snapshots are shared through the cache, never mutated. */
export type RepoTree = {
  readonly commitSha: string;
  readonly trees: Readonly<Record<string, string>>;
};

/** Thrown for every fetch failure; never swallowed into null (detection-failure visibility). */
export class GitHubApiError extends Error {
  readonly kind: GitHubApiFailureKind;
  readonly owner: string;
  readonly repo: string;
  readonly ref: string;

  constructor(kind: GitHubApiFailureKind, owner: string, repo: string, ref: string, message: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.kind = kind;
    this.owner = owner;
    this.repo = repo;
    this.ref = ref;
  }
}

export interface GitHubApiPort {
  /**
   * Fetch the recursive tree of `owner/repo` at `ref` (branch, tag, commit SHA;
   * defaults to `HEAD`). Implementations must cache per `owner/repo@ref`,
   * bound every network hop with a timeout, and throw `GitHubApiError` on
   * failure — a cache hit performs no I/O at all.
   */
  fetchRepoTree(owner: string, repo: string, ref?: string): Promise<RepoTree>;
}
