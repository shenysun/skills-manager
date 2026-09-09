import { spawnSync } from 'node:child_process';
import { GitHubApiError, type GitHubApiFailureKind, type GitHubApiPort, type RepoTree } from '../core/ports/github-api.js';

export type GhExecution = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnFailed: boolean;
};

/** Runs `gh <args>`; injectable so tests can fake the CLI without a real binary. */
export type GhExecutor = (args: string[], options: { timeoutMs: number }) => GhExecution;

export type HttpResult = {
  status: number;
  /** Response headers with lower-cased names. */
  headers: Record<string, string>;
  body: string;
};

/** Performs one HTTPS request; injectable so tests can fake responses without network. */
export type HttpFetcher = (url: string, init: { headers: Record<string, string>; timeoutMs: number }) => Promise<HttpResult>;

export type GitHubApiClientOptions = {
  ghExecutor?: GhExecutor;
  fetcher?: HttpFetcher;
  /** Cache lifetime per `owner/repo@ref`; default 5 minutes (matches the dashboard's remote-head TTL). */
  ttlMs?: number;
  /** Timeout for the gh CLI availability probe; default 5s. */
  probeTimeoutMs?: number;
  /** Timeout for each API request (gh and HTTPS alike); default 15s. */
  requestTimeoutMs?: number;
  /** Clock driving the TTL cache; injectable for tests. */
  now?: () => number;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const API_BASE_URL = 'https://api.github.com';
const ANONYMOUS_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'skills-manager',
};

const spawnGh: GhExecutor = (args, options) => {
  const result = spawnSync('gh', args, { timeout: options.timeoutMs, encoding: 'utf8', stdio: 'pipe' });
  const spawnError = result.error as { code?: string } | undefined;
  const timedOut = spawnError?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM';
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    spawnFailed: Boolean(result.error) && !timedOut,
  };
};

const fetchHttps: HttpFetcher = async (url, init) => {
  const response = await fetch(url, { headers: init.headers, signal: AbortSignal.timeout(init.timeoutMs) });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => { headers[name.toLowerCase()] = value; });
  return { status: response.status, headers, body: await response.text() };
};

type TreePayload = {
  sha?: unknown;
  truncated?: unknown;
  tree?: Array<{ path?: unknown; type?: unknown; sha?: unknown }>;
};

function toRepoTree(owner: string, repo: string, ref: string, payloadText: string): RepoTree {
  let payload: TreePayload;
  try {
    payload = JSON.parse(payloadText) as TreePayload;
  } catch (error) {
    throw new GitHubApiError('api', owner, repo, ref, `${owner}/${repo}@${ref}: unparsable GitHub tree response (${errorMessage(error)})`);
  }
  if (typeof payload.sha !== 'string' || !Array.isArray(payload.tree)) {
    throw new GitHubApiError('api', owner, repo, ref, `${owner}/${repo}@${ref}: unexpected GitHub tree response shape`);
  }
  if (payload.truncated === true) {
    throw new GitHubApiError('api', owner, repo, ref, `${owner}/${repo}@${ref}: recursive tree truncated — repository too large for tree-SHA detection`);
  }
  const trees: Record<string, string> = {};
  for (const entry of payload.tree) {
    if (entry.type === 'tree' && typeof entry.path === 'string' && typeof entry.sha === 'string') trees[entry.path] = entry.sha;
  }
  return Object.freeze({ commitSha: payload.sha, trees: Object.freeze(trees) });
}

function excerpt(text: string, max = 200): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * GitHubApiPort adapter: gh CLI first (logged-in, 5000 req/h — probed once and
 * pinned), anonymous HTTPS fallback (60 req/h), and a per-`owner/repo@ref`
 * in-memory TTL cache so a hit performs no I/O. Every failure throws
 * GitHubApiError with a distinguishable kind; nothing degrades to null.
 */
export class GitHubApiClient implements GitHubApiPort {
  private readonly ghExecutor: GhExecutor;
  private readonly fetcher: HttpFetcher;
  private readonly ttlMs: number;
  private readonly probeTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly now: () => number;
  private ghAvailable: boolean | null = null;
  private readonly cache = new Map<string, { tree: RepoTree; fetchedAt: number }>();
  private readonly inFlight = new Map<string, Promise<RepoTree>>();

  constructor(options: GitHubApiClientOptions = {}) {
    this.ghExecutor = options.ghExecutor ?? spawnGh;
    this.fetcher = options.fetcher ?? fetchHttps;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.now = options.now ?? (() => Date.now());
  }

  async fetchRepoTree(owner: string, repo: string, ref = 'HEAD'): Promise<RepoTree> {
    const normalizedRef = ref || 'HEAD';
    if (!owner || owner.includes('/') || !repo || repo.includes('/')) {
      throw new GitHubApiError('api', owner, repo, normalizedRef, `invalid repository reference: '${owner}/${repo}'`);
    }
    const key = `${owner}/${repo}@${normalizedRef}`;
    const cached = this.cache.get(key);
    if (cached && this.now() - cached.fetchedAt < this.ttlMs) return cached.tree;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const request = this.fetchUncached(owner, repo, normalizedRef).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, request);
    return request;
  }

  private async fetchUncached(owner: string, repo: string, ref: string): Promise<RepoTree> {
    const tree = this.isGhAvailable()
      ? await this.fetchViaGh(owner, repo, ref)
      : await this.fetchViaHttps(owner, repo, ref);
    this.cache.set(`${owner}/${repo}@${ref}`, { tree, fetchedAt: this.now() });
    return tree;
  }

  /** Probe verdict is computed once per client and cached; probe failures simply route to HTTPS. */
  private isGhAvailable(): boolean {
    if (this.ghAvailable === null) {
      const probe = this.ghExecutor(['auth', 'status'], { timeoutMs: this.probeTimeoutMs });
      this.ghAvailable = !probe.timedOut && !probe.spawnFailed && probe.status === 0;
    }
    return this.ghAvailable;
  }

  private async fetchViaGh(owner: string, repo: string, ref: string): Promise<RepoTree> {
    const apiPath = `repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const execution = this.ghExecutor(['api', apiPath], { timeoutMs: this.requestTimeoutMs });
    if (execution.timedOut) {
      throw new GitHubApiError('timeout', owner, repo, ref, `${owner}/${repo}@${ref}: gh api timed out after ${this.requestTimeoutMs}ms`);
    }
    if (execution.spawnFailed) {
      throw new GitHubApiError('network', owner, repo, ref, `${owner}/${repo}@${ref}: gh CLI became unavailable mid-run`);
    }
    if (execution.status !== 0) {
      throw this.ghFailure(owner, repo, ref, execution);
    }
    return toRepoTree(owner, repo, ref, execution.stdout);
  }

  private ghFailure(owner: string, repo: string, ref: string, execution: GhExecution): GitHubApiError {
    const detail = excerpt(execution.stderr || execution.stdout);
    const kind: GitHubApiFailureKind = /http 404|not found/i.test(detail)
      ? 'not_found'
      : /rate limit|http 429/i.test(detail)
        ? 'rate_limited'
        : /connect|resolve|connection|network|timed out/i.test(detail)
          ? 'network'
          : 'api';
    return new GitHubApiError(kind, owner, repo, ref, `${owner}/${repo}@${ref}: gh api failed (exit ${execution.status}): ${detail}`);
  }

  private async fetchViaHttps(owner: string, repo: string, ref: string): Promise<RepoTree> {
    const url = `${API_BASE_URL}/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    let result: HttpResult;
    try {
      result = await this.fetcher(url, { headers: { ...ANONYMOUS_HEADERS }, timeoutMs: this.requestTimeoutMs });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new GitHubApiError('timeout', owner, repo, ref, `${owner}/${repo}@${ref}: GitHub API request timed out after ${this.requestTimeoutMs}ms`);
      }
      throw new GitHubApiError('network', owner, repo, ref, `${owner}/${repo}@${ref}: GitHub API request failed (${errorMessage(error)})`);
    }
    if (result.status === 404) {
      throw new GitHubApiError('not_found', owner, repo, ref, `${owner}/${repo}@${ref}: repository or ref not found`);
    }
    if ((result.status === 403 || result.status === 429) && result.headers['x-ratelimit-remaining'] === '0') {
      throw new GitHubApiError('rate_limited', owner, repo, ref, `${owner}/${repo}@${ref}: GitHub API rate limit exhausted (60 req/h anonymous)`);
    }
    if (result.status !== 200) {
      throw new GitHubApiError('api', owner, repo, ref, `${owner}/${repo}@${ref}: GitHub API responded ${result.status}: ${excerpt(result.body)}`);
    }
    return toRepoTree(owner, repo, ref, result.body);
  }
}
