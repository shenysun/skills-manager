import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { createRuntimeServices } from '../../src/infra/runtime.js';
import type { GitHubApiPort } from '../../src/core/ports/github-api.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { footprintOf } from '../../dashboard-web/src/domain/costLedger.js';

// Offline GitHub fake: same reason as dashboard-state — this suite is entirely
// local; without it the state row cases would reach api.github.com for real.
const offlineGitHubApi: GitHubApiPort = {
  async fetchRepoTree() {
    return Object.freeze({ commitSha: 'offline', trees: Object.freeze({}) });
  },
};

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;
let app: ReturnType<typeof createDashboardApp>;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'cost-api-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
  mkdirSync(path.join(sourceRoot, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ndescription: api
---
# Alpha
`);
  mkdirSync(path.join(userHome, '.claude'), { recursive: true });
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
    githubApi: offlineGitHubApi,
  });
  await app.ready();
  const install = await app.inject({ method: 'POST', url: '/api/install', payload: { source: sourceRoot, subpaths: ['alpha'], overwrite: true } });
  expect(JSON.parse(install.body).ok).toBe(true);
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

async function getCost() {
  const response = await app.inject({ method: 'GET', url: '/api/cost' });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body).data;
}

describe('GET /api/cost (resident-cost ledger, lazy-loaded)', () => {
  it('returns the full ledger JSON: three layers plus method', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['claude-code'] } });
    const ledger = await getCost();
    expect(Object.keys(ledger).sort()).toEqual(['errors', 'method', 'paths', 'suggestions', 'totalTokens', 'unmanaged']);
    expect(ledger.method).toBe('char-approx');
    expect(Object.keys(ledger.suggestions).sort()).toEqual(['archived', 'scattered', 'topDescriptions']);
    expect(ledger.paths).toEqual([
      {
        runtimeDir: path.join(userHome, '.claude', 'skills'),
        kind: 'user',
        agents: ['claude-code'],
        tokens: expect.any(Number),
        skills: [expect.objectContaining({ skill: 'alpha', tokens: expect.any(Number) })],
      },
    ]);
    expect(ledger.totalTokens).toBe(ledger.paths[0].tokens);
    expect(ledger.totalTokens).toBeGreaterThan(0);
    expect(ledger.errors).toEqual([]);
  });

  it('is empty before any distribution and still carries method and the layers', async () => {
    const ledger = await getCost();
    expect(ledger.method).toBe('char-approx');
    expect(ledger.paths).toEqual([]);
    expect(ledger.totalTokens).toBe(0);
    expect(ledger.suggestions).toEqual({ archived: [], topDescriptions: [], scattered: [] });
  });

  it('is the same JSON `cost --json` emits — same core, no adapter recompute', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['claude-code'] } });
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'project', projectRoot: path.join(root, 'proj-a'), skills: ['alpha'], agents: ['warp'] } });
    const fromApi = await getCost();
    const fromCore = createRuntimeServices({ home, cwd: root, env: {}, userHome, catalogSnapshot: fixtureSnapshot() }, root).cost.ledger();
    expect(fromApi).toEqual(fromCore);
  });
});

describe('GET /api/state shape (the ledger never leaks into state)', () => {
  it('keeps exactly the four slim keys after the cost endpoint exists', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['claude-code'] } });
    const response = await app.inject({ method: 'GET', url: '/api/state' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(Object.keys(body.data).sort()).toEqual(['activity', 'knownProjects', 'skills', 'updateCount']);
    expect(body.data.skills[0]).not.toHaveProperty('cost');
    expect(body.data).not.toHaveProperty('residentCost');
  });
});

// The preview's row-tail footprint joins the two lazy surfaces by string: the
// state endpoint's distribution runtimePath → dirname → the ledger's
// runtimeDir. This pins the join against real endpoint output, where a
// normalization drift between the two surfaces would silently blank the `· ≈N`.
describe('state × cost wiring (preview footprint join, US23)', () => {
  it('resolves a resident footprint for every distributed row of both endpoints', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['claude-code'] } });
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'project', projectRoot: path.join(root, 'proj-a'), skills: ['alpha'], agents: ['warp'] } });

    const stateResponse = await app.inject({ method: 'GET', url: '/api/state' });
    const alpha = JSON.parse(stateResponse.body).data.skills.find((skill: { name: string }) => skill.name === 'alpha');
    const rows = alpha.distribution.flatMap((target: { entries: Array<{ runtimePath: string }> }) => target.entries.map((entry) => entry.runtimePath));
    expect(rows.length).toBe(2);

    const ledger = await getCost();
    for (const runtimePath of rows) {
      expect(footprintOf(ledger, 'alpha', runtimePath), runtimePath).toBeGreaterThan(0);
    }
  });
});
