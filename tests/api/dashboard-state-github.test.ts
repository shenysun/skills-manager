import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { GitHubApiError, type GitHubApiPort, type RepoTree } from '../../src/core/ports/github-api.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const REPO_URL = 'https://github.com/acme/skills.git';

type RecordedCall = { owner: string; repo: string; ref: string };

function repoTree(commitSha: string, trees: Record<string, string>): RepoTree {
  return Object.freeze({ commitSha, trees: Object.freeze({ ...trees }) });
}

/** Fake GitHubApiPort straight out of the port interface: records every call, answers from the per-test responder. */
function recordingGitHubApi(respond: (call: RecordedCall) => RepoTree | GitHubApiError) {
  const calls: RecordedCall[] = [];
  const port: GitHubApiPort = {
    async fetchRepoTree(owner: string, repo: string, ref = 'HEAD') {
      const call = { owner, repo, ref };
      calls.push(call);
      const outcome = respond(call);
      if (outcome instanceof GitHubApiError) throw outcome;
      return outcome;
    },
  };
  return { port, calls };
}

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;
let app: ReturnType<typeof createDashboardApp>;
let calls: RecordedCall[];
let responder: (call: RecordedCall) => RepoTree | GitHubApiError;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'state-github-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
  for (const name of ['alpha', 'beta']) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: ${name}\n---\n# ${name}\n`);
  }
  mkdirSync(path.join(userHome, '.claude'), { recursive: true });
  responder = () => repoTree('c0', {});
  const fake = recordingGitHubApi((call) => responder(call));
  calls = fake.calls;
  app = createDashboardApp({
    home,
    cwd: root,
    env: {},
    userHome,
    catalogSnapshot: fixtureSnapshot(),
    port: 0,
    host: '127.0.0.1',
    open: false,
    projectRoot: path.resolve(import.meta.dirname, '..', '..'),
    githubApi: fake.port,
  });
  await app.ready();
  const install = await app.inject({ method: 'POST', url: '/api/install', payload: { source: sourceRoot, subpaths: ['skills/alpha', 'skills/beta'], overwrite: true } });
  expect(JSON.parse(install.body).ok).toBe(true);
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

async function getState() {
  const response = await app.inject({ method: 'GET', url: '/api/state' });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body).data;
}

function registryFile() {
  return path.join(home, 'registry.yaml');
}

function readRegistry() {
  return YAML.parse(readFileSync(registryFile(), 'utf8')) as { skills: Record<string, { source?: Record<string, unknown> }> };
}

/** Rewrites one skill's source block in registry.yaml — the hand-edit stand-in for provenance drift. */
function setGitSource(skill: string, source: Record<string, unknown>) {
  const registry = readRegistry();
  registry.skills[skill].source = source;
  writeFileSync(registryFile(), YAML.stringify(registry, { lineWidth: 0 }));
}

function rowOf(state: Awaited<ReturnType<typeof getState>>, name: string) {
  return state.skills.find((skill: { name: string }) => skill.name === name);
}

describe('GET /api/state GitHub update detection (ADR-0013: tree SHA anchor + per-source fan-in)', () => {
  it('fetches the repo tree once per owner/repo@ref, shared by every skill of that source', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: 't-alpha' });
    setGitSource('beta', { type: 'git', url: REPO_URL, subpath: 'skills/beta', ref: null, upstream_commit: 'c0', upstream_tree: 't-beta' });
    responder = () => repoTree('c0', { 'skills/alpha': 't-alpha', 'skills/beta': 't-beta' });
    const state = await getState();
    expect(calls).toEqual([{ owner: 'acme', repo: 'skills', ref: 'HEAD' }]);
    expect(rowOf(state, 'alpha').hasUpdate).toBe(false);
    expect(rowOf(state, 'beta').hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
  });

  it('fetches once per distinct ref of the same repo', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: 'main', upstream_commit: 'c0', upstream_tree: 't-alpha' });
    setGitSource('beta', { type: 'git', url: REPO_URL, subpath: 'skills/beta', ref: null, upstream_commit: 'c0', upstream_tree: 't-beta' });
    responder = ({ ref }) => repoTree('c0', ref === 'main' ? { 'skills/alpha': 't-alpha' } : { 'skills/beta': 't-beta' });
    const state = await getState();
    expect(calls).toEqual([
      { owner: 'acme', repo: 'skills', ref: 'main' },
      { owner: 'acme', repo: 'skills', ref: 'HEAD' },
    ]);
    expect(state.updateCount).toBe(0);
  });

  it('resolves GitHub repo URLs with and without the .git suffix', async () => {
    setGitSource('alpha', { type: 'git', url: 'https://github.com/acme/skills', subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: 't-alpha' });
    responder = () => repoTree('c0', { 'skills/alpha': 't-alpha' });
    await getState();
    expect(calls).toEqual([{ owner: 'acme', repo: 'skills', ref: 'HEAD' }]);
  });

  it('lights hasUpdate only when the anchored sub-directory tree SHA really changed', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: 't-old' });
    responder = () => repoTree('c1', { 'skills/alpha': 't-new' });
    const state = await getState();
    expect(rowOf(state, 'alpha').hasUpdate).toBe(true);
    expect(state.updateCount).toBe(1);
  });

  it('stays unlit when an unrelated upstream commit leaves the skill tree untouched', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: null, upstream_commit: 'c-old', upstream_tree: 't-alpha' });
    responder = () => repoTree('c-readme-touched', { 'skills/alpha': 't-alpha' });
    const state = await getState();
    expect(rowOf(state, 'alpha').hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
  });

  it('calibrates on first detection: writes the observed tree SHA back to registry.yaml and flags no update', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: null });
    responder = () => repoTree('c0', { 'skills/alpha': 't-alpha' });
    const state = await getState();
    expect(rowOf(state, 'alpha').hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
    expect(readRegistry().skills.alpha.source?.upstream_tree).toBe('t-alpha');
  });

  it('is idempotent after calibration: an unchanged tree rewrites nothing', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: null });
    responder = () => repoTree('c0', { 'skills/alpha': 't-alpha' });
    await getState();
    expect(readRegistry().skills.alpha.source?.upstream_tree).toBe('t-alpha');
    const calibrated = readFileSync(registryFile(), 'utf8');
    const state = await getState();
    expect(readFileSync(registryFile(), 'utf8')).toBe(calibrated);
    expect(rowOf(state, 'alpha').hasUpdate).toBe(false);
  });

  it('keeps non-GitHub git URLs off the Trees API (ls-remote path, legacy semantics)', async () => {
    setGitSource('alpha', { type: 'git', url: 'https://gitlab.com/acme/skills.git', subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: 't-alpha' });
    const state = await getState();
    expect(calls).toEqual([]);
    // Unreachable non-GitHub remote stays quiet rather than crying wolf — the pre-ADR-0013 behaviour.
    expect(rowOf(state, 'alpha').hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
  });

  it('keeps the rest of the payload when the GitHub API fails (transitional handling; ticket 06 adds the explicit state)', async () => {
    setGitSource('alpha', { type: 'git', url: REPO_URL, subpath: 'skills/alpha', ref: null, upstream_commit: 'c0', upstream_tree: null });
    responder = () => new GitHubApiError('network', 'acme', 'skills', 'HEAD', 'api.github.com unreachable');
    const state = await getState();
    expect(rowOf(state, 'alpha').hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
    expect(rowOf(state, 'alpha').name).toBe('alpha');
    expect(state.skills).toHaveLength(2);
    // A failed detection must not calibrate either — no tree SHA was observed.
    expect(readRegistry().skills.alpha.source?.upstream_tree ?? null).toBeNull();
  });
});
