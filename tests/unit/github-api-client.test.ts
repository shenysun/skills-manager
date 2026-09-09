import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { GitHubApiClient } from '../../src/infra/github-api-client.js';
import type { GhExecution, GhExecutor, HttpFetcher, HttpResult } from '../../src/infra/github-api-client.js';
import { GitHubApiError } from '../../src/core/index.js';

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));

type GhCall = { args: string[]; timeoutMs: number };
type FetchCall = { url: string; headers: Record<string, string>; timeoutMs: number };

const OK: GhExecution = { status: 0, stdout: '', stderr: '', timedOut: false, spawnFailed: false };

function createFakeGh(script: GhExecution[]) {
  const calls: GhCall[] = [];
  const executor: GhExecutor = (args, options) => {
    calls.push({ args, timeoutMs: options.timeoutMs });
    const next = script.shift();
    if (!next) throw new Error(`unexpected gh call: gh ${args.join(' ')}`);
    return next;
  };
  return {
    calls,
    executor,
    probes: () => calls.filter((call) => call.args[0] === 'auth'),
    apiCalls: () => calls.filter((call) => call.args[0] === 'api'),
  };
}

function createFakeFetch(script: Array<HttpResult | Error>) {
  const calls: FetchCall[] = [];
  const fetcher: HttpFetcher = async (url, init) => {
    calls.push({ url, headers: init.headers, timeoutMs: init.timeoutMs });
    const next = script.shift();
    if (!next) throw new Error(`unexpected fetch: ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetcher };
}

function treePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sha: 'commit-abc123',
    truncated: false,
    tree: [
      { path: 'skills', type: 'tree', sha: 'tree-skills' },
      { path: 'skills/foo', type: 'tree', sha: 'tree-foo' },
      { path: 'skills/foo/SKILL.md', type: 'blob', sha: 'blob-skill-md' },
      { path: 'docs', type: 'tree', sha: 'tree-docs' },
    ],
    ...overrides,
  });
}

const expectedTrees = () => ({ skills: 'tree-skills', 'skills/foo': 'tree-foo', docs: 'tree-docs' });

function manualClock(start = 1_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

async function rejection(promise: Promise<unknown>): Promise<GitHubApiError> {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof GitHubApiError)) throw new Error(`expected GitHubApiError, got: ${error}`);
    return error;
  }
  throw new Error('expected fetchRepoTree to reject');
}

describe('GitHubApiClient', () => {
  beforeEach(() => {
    vi.mocked(spawnSync).mockReset();
    vi.unstubAllGlobals();
  });

  it('prefers gh api when the CLI is logged in and maps sub-directory tree SHAs', async () => {
    const gh = createFakeGh([OK, { ...OK, stdout: treePayload() }]);
    const fetch = createFakeFetch([]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    const tree = await client.fetchRepoTree('mattpocock', 'skills');

    expect(tree.commitSha).toBe('commit-abc123');
    expect(tree.trees).toEqual(expectedTrees());
    expect('' in tree.trees).toBe(false);
    expect(fetch.calls).toHaveLength(0);
    expect(gh.probes()).toEqual([{ args: ['auth', 'status'], timeoutMs: 5000 }]);
    expect(gh.apiCalls()).toEqual([{ args: ['api', 'repos/mattpocock/skills/git/trees/HEAD?recursive=1'], timeoutMs: 15000 }]);
  });

  it('falls back to anonymous HTTPS when gh is not logged in', async () => {
    const gh = createFakeGh([{ ...OK, status: 1 }]);
    const fetch = createFakeFetch([{ status: 200, headers: {}, body: treePayload({ sha: 'commit-https' }) }]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    const tree = await client.fetchRepoTree('mattpocock', 'skills');

    expect(tree.commitSha).toBe('commit-https');
    expect(tree.trees).toEqual(expectedTrees());
    expect(gh.apiCalls()).toHaveLength(0);
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0].url).toBe('https://api.github.com/repos/mattpocock/skills/git/trees/HEAD?recursive=1');
    expect(fetch.calls[0].headers.Accept).toBe('application/vnd.github+json');
    expect(fetch.calls[0].headers['User-Agent']).toBe('skills-manager');
  });

  it('encodes refs for URLs and treats an empty ref as HEAD', async () => {
    const gh = createFakeGh([{ ...OK, spawnFailed: true }]);
    const fetch = createFakeFetch([{ status: 200, headers: {}, body: treePayload() }, { status: 200, headers: {}, body: treePayload() }]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    await client.fetchRepoTree('a', 'b', 'feat/x');
    await client.fetchRepoTree('a', 'b', '');

    expect(fetch.calls[0].url).toBe('https://api.github.com/repos/a/b/git/trees/feat%2Fx?recursive=1');
    expect(fetch.calls[1].url).toBe('https://api.github.com/repos/a/b/git/trees/HEAD?recursive=1');
  });

  it('probes gh exactly once across requests', async () => {
    const gh = createFakeGh([OK, { ...OK, stdout: treePayload() }, { ...OK, stdout: treePayload({ sha: 'c2' }) }]);
    const fetch = createFakeFetch([]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    await client.fetchRepoTree('a', 'one');
    await client.fetchRepoTree('a', 'two');

    expect(gh.probes()).toHaveLength(1);
    expect(gh.apiCalls()).toHaveLength(2);
  });

  it('serves TTL hits without any I/O and refetches after expiry', async () => {
    const clock = manualClock();
    const gh = createFakeGh([OK, { ...OK, stdout: treePayload() }, { ...OK, stdout: treePayload({ sha: 'commit-later' }) }]);
    const fetch = createFakeFetch([]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher, ttlMs: 1000, now: clock.now });

    const first = await client.fetchRepoTree('a', 'b');
    const cached = await client.fetchRepoTree('a', 'b');
    clock.advance(1000);
    const refreshed = await client.fetchRepoTree('a', 'b');

    expect(cached).toBe(first);
    expect(gh.apiCalls()).toHaveLength(2);
    expect(refreshed.commitSha).toBe('commit-later');
  });

  it('deduplicates concurrent requests for the same key', async () => {
    let release: (result: HttpResult) => void = () => {};
    const gate = new Promise<HttpResult>((resolve) => { release = resolve; });
    const calls: string[] = [];
    const fetcher: HttpFetcher = async (url) => { calls.push(url); return gate; };
    const gh = createFakeGh([{ ...OK, status: 1 }]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher });

    const first = client.fetchRepoTree('a', 'b');
    const second = client.fetchRepoTree('a', 'b');
    release({ status: 200, headers: {}, body: treePayload() });
    const [a, b] = await Promise.all([first, second]);

    expect(calls).toHaveLength(1);
    expect(a).toBe(b);
  });

  it('classifies HTTPS failures: not found, rate limit, other HTTP status', async () => {
    const cases: Array<{ response: HttpResult | Error; kind: string; message: RegExp }> = [
      { response: { status: 404, headers: {}, body: '{"message":"Not Found"}' }, kind: 'not_found', message: /not found/ },
      { response: { status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: 'rate limit' }, kind: 'rate_limited', message: /rate limit/ },
      { response: { status: 500, headers: {}, body: 'boom' }, kind: 'api', message: /500/ },
    ];
    for (const testCase of cases) {
      const gh = createFakeGh([{ ...OK, status: 1 }]);
      const fetch = createFakeFetch([testCase.response]);
      const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });
      const error = await rejection(client.fetchRepoTree('a', 'b'));
      expect(error.kind).toBe(testCase.kind);
      expect(error.message).toMatch(testCase.message);
    }
  });

  it('classifies HTTPS transport failures: timeout and network', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    for (const [failure, kind] of [[timeoutError, 'timeout'], [new TypeError('fetch failed'), 'network']] as const) {
      const gh = createFakeGh([{ ...OK, status: 1 }]);
      const fetch = createFakeFetch([failure]);
      const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });
      const error = await rejection(client.fetchRepoTree('a', 'b'));
      expect(error.kind).toBe(kind);
    }
  });

  it('classifies gh failures by stderr: not found, rate limit, network, timeout, other', async () => {
    const cases: Array<[GhExecution, string]> = [
      [{ ...OK, status: 1, stderr: 'gh: Not Found (HTTP 404)' }, 'not_found'],
      [{ ...OK, status: 1, stderr: 'gh: API rate limit exceeded for user (HTTP 403)' }, 'rate_limited'],
      [{ ...OK, status: 1, stderr: 'gh: connect: connection refused' }, 'network'],
      [{ ...OK, status: 1, timedOut: true, stderr: '' }, 'timeout'],
      [{ ...OK, status: 1, stderr: 'gh: Bad credentials (HTTP 401)' }, 'api'],
    ];
    for (const [execution, kind] of cases) {
      const gh = createFakeGh([OK, execution]);
      const fetch = createFakeFetch([]);
      const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });
      const error = await rejection(client.fetchRepoTree('a', 'b'));
      expect(error.kind).toBe(kind);
      expect(`${error.owner}/${error.repo}@${error.ref}`).toBe('a/b@HEAD');
    }
  });

  it('does not cache failures — the next call retries', async () => {
    const gh = createFakeGh([{ ...OK, status: 1 }, { ...OK, status: 1 }]);
    const fetch = createFakeFetch([
      { status: 404, headers: {}, body: '' },
      { status: 200, headers: {}, body: treePayload() },
    ]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    await rejection(client.fetchRepoTree('a', 'b'));
    const tree = await client.fetchRepoTree('a', 'b');

    expect(fetch.calls).toHaveLength(2);
    expect(tree.commitSha).toBe('commit-abc123');
  });

  it('rejects truncated and malformed tree responses', async () => {
    const gh = createFakeGh([OK, { ...OK, stdout: treePayload({ truncated: true }) }, OK, { ...OK, stdout: 'not json' }]);
    const fetch = createFakeFetch([]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    const truncated = await rejection(client.fetchRepoTree('a', 'b'));
    expect(truncated.kind).toBe('api');
    expect(truncated.message).toMatch(/truncated/);

    const malformed = await rejection(client.fetchRepoTree('c', 'd'));
    expect(malformed.kind).toBe('api');
    expect(malformed.message).toMatch(/unparsable/);
  });

  it('rejects invalid owner/repo before any I/O', async () => {
    const gh = createFakeGh([]);
    const fetch = createFakeFetch([]);
    const client = new GitHubApiClient({ ghExecutor: gh.executor, fetcher: fetch.fetcher });

    for (const [owner, repo] of [['', 'b'], ['a/b', 'c'], ['a', '']] as const) {
      const error = await rejection(client.fetchRepoTree(owner, repo));
      expect(error.kind).toBe('api');
    }
    expect(gh.calls).toHaveLength(0);
    expect(fetch.calls).toHaveLength(0);
  });

  describe('default wiring', () => {
    it('drives the real spawnSync path end to end via gh', async () => {
      vi.mocked(spawnSync).mockImplementation(((command: string, args: string[]) => {
        if (args[0] === 'auth') return { status: 0, stdout: '', stderr: '', error: undefined, signal: null };
        return { status: 0, stdout: treePayload(), stderr: '', error: undefined, signal: null };
      }) as unknown as typeof spawnSync);
      const client = new GitHubApiClient();

      const tree = await client.fetchRepoTree('a', 'b', 'main');

      expect(tree.trees).toEqual(expectedTrees());
      expect(tree.commitSha).toBe('commit-abc123');
      expect(spawnSync).toHaveBeenCalledWith('gh', ['api', 'repos/a/b/git/trees/main?recursive=1'], expect.objectContaining({ timeout: 15000 }));
    });

    it('maps a spawn failure to the HTTPS path and lower-cases response headers', async () => {
      vi.mocked(spawnSync).mockImplementation((() => ({
        status: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }),
        signal: null,
      })) as unknown as typeof spawnSync);
      const response = {
        status: 200,
        headers: { forEach(callback: (value: string, name: string) => void) { callback('application/json', 'Content-Type'); } },
        text: async () => treePayload({ sha: 'commit-anon' }),
      };
      vi.stubGlobal('fetch', vi.fn(async () => response));
      const client = new GitHubApiClient();

      const tree = await client.fetchRepoTree('a', 'b');

      expect(tree.commitSha).toBe('commit-anon');
      const fetchCall = vi.mocked(globalThis.fetch).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.github.com/repos/a/b/git/trees/HEAD?recursive=1');
    });
  });
});
