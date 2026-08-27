import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let app: ReturnType<typeof createDashboardApp>;
let services: ReturnType<typeof createCoreServices>;
let project: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'api-refresh-'));
  const home = path.join(root, 'home');
  const userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  const sourceRoot = path.join(root, 'source');
  for (const name of ['alpha']) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
  }
  services = createCoreServices({
    skillHomeRoot: home, projectRoot: root,
    fs: createNodeFileSystem(), git: fakeGit, processRunner: fakeRunner,
    userHome, env: {}, catalogSnapshot: fixtureSnapshot(),
  });
  services.skillHome.ensure();
  services.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
  services.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'], mode: 'copy' });
  writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
  app = createDashboardApp({
    home,
    cwd: root,
    env: {},
    userHome,
    catalogSnapshot: fixtureSnapshot(),
    port: 0,
    host: '127.0.0.1',
    open: false,
    projectRoot: root,
    services,
  });
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

describe('POST /api/distribute/refresh', () => {
  it('refreshes stale entries and reports counts', async () => {
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/api/distribute/refresh', payload: { skill: 'alpha' } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.data.refreshed).toBe(1);
    expect(body.data.errored).toBe(0);
  });

  it('records errors instead of throwing when the target is missing', async () => {
    rmSync(path.join(project, '.agents'), { recursive: true, force: true });
    await app.ready();
    const response = await app.inject({ method: 'POST', url: '/api/distribute/refresh', payload: { skill: 'alpha' } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.errored).toBe(1);
    expect(body.data.errors[0].runtimePath.endsWith('.agents/skills/alpha')).toBe(true);
  });
});
