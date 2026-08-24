import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;
let app: ReturnType<typeof createDashboardApp>;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'catalog-api-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
  mkdirSync(path.join(sourceRoot, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: api\n---\n# Alpha\n`);
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
  });
  await app.ready();
  const install = await app.inject({ method: 'POST', url: '/api/install', payload: { source: sourceRoot, subpaths: ['alpha'], overwrite: true } });
  expect(JSON.parse(install.body).ok).toBe(true);
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('GET /api/catalog/agents (picker data)', () => {
  it('returns user-scope agents with detected flags, family keys, and invalid reasons', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/catalog/agents?scope=user' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body).data;
    expect(body.scope).toBe('user');
    const claude = body.agents.find((agent: { id: string }) => agent.id === 'claude-code');
    expect(claude).toMatchObject({ detected: true, invalidReason: null });
    expect(claude.familyKey).toContain(path.join(userHome, '.claude', 'skills'));
    const warp = body.agents.find((agent: { id: string }) => agent.id === 'warp');
    const zed = body.agents.find((agent: { id: string }) => agent.id === 'zed');
    expect(warp.familyKey).toBe(zed.familyKey);
    const eve = body.agents.find((agent: { id: string }) => agent.id === 'eve');
    expect(eve).toMatchObject({ familyKey: null });
    expect(eve.invalidReason).toMatch(/project-only/i);
    expect(body.agents).toHaveLength(fixtureSnapshot().agents.length);
  });

  it('returns project-scope agents keyed by project runtime dirs with eve valid', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/catalog/agents?scope=project&projectRoot=' + encodeURIComponent(path.join(root, 'proj')) });
    const body = JSON.parse(response.body).data;
    const eve = body.agents.find((agent: { id: string }) => agent.id === 'eve');
    expect(eve.invalidReason).toBeNull();
    expect(eve.familyKey).toContain('agent/skills');
    const codex = body.agents.find((agent: { id: string }) => agent.id === 'codex');
    expect(codex.familyKey).toContain('.agents/skills');
  });
});

describe('distribute endpoints over agent sets', () => {
  it('applies and removes with agent ids and one mode, same service as the CLI', async () => {
    const applied = await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['zed', 'warp'] } });
    expect(JSON.parse(applied.body).ok).toBe(true);
    const applyData = JSON.parse(applied.body).data;
    expect(applyData.mode).toBe('symlink');
    expect(applyData.entries).toHaveLength(1);
    expect(applyData.entries[0].agents.sort()).toEqual(['warp', 'zed']);
    const removed = await app.inject({ method: 'POST', url: '/api/undistribute', payload: { to: 'user', skills: ['alpha'], agents: ['warp'] } });
    expect(JSON.parse(removed.body).ok).toBe(true);
    const state = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
    expect(state.distributions.user.entries[0].agents).toEqual(['zed']);
  });
});

describe('overview statistics', () => {
  it('reports managed entries and unique agent coverage with no legacy count fields', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['zed', 'warp', 'claude-code'] } });
    const state = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
    expect(state.counts).toEqual({ skills: 1, sources: 1, managedEntries: 2, agentCoverage: 3, outdated: 0 });
    expect('agents' in state.counts).toBe(false);
    expect('claude' in state.counts).toBe(false);
  });
});

describe('registry structured edit accepts catalog ids only', () => {
  it('rejects legacy and unknown ids with migrate-consumers guidance', async () => {
    const legacy = await app.inject({ method: 'POST', url: '/api/registry/edit', payload: { skill: 'alpha', patch: { consumers: ['agents'] } } });
    expect(legacy.statusCode).toBe(400);
    expect(JSON.parse(legacy.body).error.message).toMatch(/migrate-consumers/);
    const unknown = await app.inject({ method: 'POST', url: '/api/registry/edit', payload: { skill: 'alpha', patch: { consumers: ['not-an-agent'] } } });
    expect(unknown.statusCode).toBe(400);
  });

  it('accepts catalog ids as desired default agents', async () => {
    const ok = await app.inject({ method: 'POST', url: '/api/registry/edit', payload: { skill: 'alpha', patch: { consumers: ['claude-code', 'zed'] } } });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).data.consumers.sort()).toEqual(['claude-code', 'zed']);
  });
});
