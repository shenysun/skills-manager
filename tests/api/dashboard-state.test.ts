import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;
let app: ReturnType<typeof createDashboardApp>;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'state-api-'));
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

async function getState() {
  const response = await app.inject({ method: 'GET', url: '/api/state' });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body).data;
}

/** Registry consumers tags are desired defaults (hand-edited registry.yaml), never observed state. */
function patchRegistry(patch: (entry: Record<string, unknown>) => void) {
  const file = path.join(home, 'registry.yaml');
  const registry = YAML.parse(readFileSync(file, 'utf8')) as { skills: Record<string, Record<string, unknown>> };
  patch(registry.skills.alpha);
  writeFileSync(file, YAML.stringify(registry, { lineWidth: 0 }));
}

describe('GET /api/state (single-page slim contract)', () => {
  it('returns only skills, activity, and updateCount', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/state' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual(['activity', 'skills', 'updateCount']);
  });

  it('describes every skill in one row with the seven single-page fields', async () => {
    const state = await getState();
    expect(state.skills).toHaveLength(1);
    const alpha = state.skills[0];
    expect(Object.keys(alpha).sort()).toEqual(['category', 'description', 'distributedAgents', 'hasUpdate', 'name', 'sourceType', 'warning']);
    expect(alpha.name).toBe('alpha');
    expect(alpha.description).toBe('api');
    expect(alpha.sourceType).toBe('local');
    expect(alpha.warning).toBeNull();
    expect(alpha.distributedAgents).toEqual([]);
  });

  it('carries recent operations in activity', async () => {
    const state = await getState();
    expect(Array.isArray(state.activity)).toBe(true);
    expect(state.activity.some((record: { action: string }) => record.action === 'install')).toBe(true);
  });

  it('derives hasUpdate by diffing the hub tree against the local source', async () => {
    // Fresh install: hub content equals source content — nothing to do.
    let state = await getState();
    expect(state.skills[0].hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
    // Upstream drift: the source moves ahead of the hub.
    appendFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), '\n# v2\n');
    state = await getState();
    expect(state.skills[0].hasUpdate).toBe(true);
    expect(state.updateCount).toBe(1);
  });

  it('clears hasUpdate after the skill is updated from its source', async () => {
    appendFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), '\n# v2\n');
    expect((await getState()).skills[0].hasUpdate).toBe(true);
    const response = await app.inject({ method: 'POST', url: '/api/update/skills', payload: { skills: ['alpha'] } });
    expect(response.statusCode).toBe(200);
    const state = await getState();
    expect(state.skills[0].hasUpdate).toBe(false);
    expect(state.updateCount).toBe(0);
  });

  it('derives distributedAgents from the hub index logical layer, not registry consumers tags', async () => {
    const applied = await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['warp'] } });
    expect(JSON.parse(applied.body).ok).toBe(true);
    patchRegistry((entry) => {
      entry.consumers = ['zed', 'claude-code'];
    });
    const state = await getState();
    expect(state.skills[0].distributedAgents).toEqual(['warp']);
  });

  it('reflects undistribute immediately in distributedAgents', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['zed', 'warp'] } });
    expect((await getState()).skills[0].distributedAgents).toEqual(['warp', 'zed']);
    await app.inject({ method: 'POST', url: '/api/undistribute', payload: { to: 'user', skills: ['alpha'], agents: ['warp'] } });
    expect((await getState()).skills[0].distributedAgents).toEqual(['zed']);
  });

  it('marks a warning on a row whose distributed runtime link is broken', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['claude-code'] } });
    const runtimePath = path.join(userHome, '.claude', 'skills', 'alpha');
    expect(lstatSync(runtimePath).isSymbolicLink()).toBe(true);
    rmSync(runtimePath);
    symlinkSync(path.join(root, 'gone'), runtimePath);
    const state = await getState();
    expect(typeof state.skills[0].warning).toBe('string');
    expect(state.skills[0].warning).toMatch(/alpha/);
  });

  it('marks a warning on a row whose copy is outdated versus the hub', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['claude-code'], mode: 'copy' } });
    appendFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), '\n# hub changed\n');
    const state = await getState();
    expect(state.skills[0].warning).toMatch(/outdated/i);
  });
});

describe('deleted dashboard endpoints', () => {
  it('404s every endpoint the single page does not consume', async () => {
    const deadRoutes: Array<[string, string]> = [
      ['GET', '/api/registry'],
      ['POST', '/api/registry/edit'],
      ['GET', '/api/sources'],
      ['POST', '/api/update/source'],
      ['GET', '/api/activity'],
      ['GET', '/api/doctor'],
      ['GET', '/api/package'],
      ['POST', '/api/package/dry-run'],
      ['POST', '/api/redistribute'],
      ['POST', '/api/distribute/rollback'],
      ['POST', '/api/migrate-views'],
      ['GET', '/api/skills'],
      ['GET', '/api/updates'],
    ];
    for (const [method, url] of deadRoutes) {
      const response = await app.inject({ method, url, ...(method === 'GET' ? {} : { payload: {} }) });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });
});

describe('kept endpoints regression', () => {
  it('serves the picker catalog and discover', async () => {
    const catalog = await app.inject({ method: 'GET', url: '/api/catalog/agents?scope=user' });
    expect(catalog.statusCode).toBe(200);
    expect(JSON.parse(catalog.body).data.agents).toHaveLength(fixtureSnapshot().agents.length);
    const discovered = await app.inject({ method: 'POST', url: '/api/discover', payload: { source: sourceRoot } });
    expect(JSON.parse(discovered.body).ok).toBe(true);
  });

  it('updates skills via the update/skills endpoint', async () => {
    appendFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), '\n# v2\n');
    const response = await app.inject({ method: 'POST', url: '/api/update/skills', payload: { skills: ['alpha'] } });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.updated).toEqual(['alpha']);
  });

  it('archives skills and drops them from the state rows', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/skills/archive', payload: { skills: ['alpha'] } });
    expect(JSON.parse(response.body).ok).toBe(true);
    const state = await getState();
    expect(state.skills).toEqual([]);
    expect(state.updateCount).toBe(0);
  });
});
