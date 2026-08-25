import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDashboardApp } from '../dist/dashboard/server/main.js';

const temp = mkdtempSync(path.join(os.tmpdir(), 'skills-api-smoke-'));
try {
  const app = createDashboardApp({ home: path.join(temp, 'home'), port: 0, host: '127.0.0.1', open: false, projectRoot: process.cwd(), userHome: path.join(temp, 'user-home') });
  const state = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(state.statusCode, 200);
  assert.equal(JSON.parse(state.body).ok, true);
  assert.deepEqual(Object.keys(JSON.parse(state.body).data).sort(), ['activity', 'knownProjects', 'skills', 'updateCount']);
  const bad = await app.inject({ method: 'POST', url: '/api/discover', payload: {} });
  assert.equal(bad.statusCode, 400);
  const dead = await app.inject({ method: 'GET', url: '/api/doctor' });
  assert.equal(dead.statusCode, 404);

  const sourceRoot = path.join(temp, 'source');
  await import('node:fs').then(({ mkdirSync, writeFileSync }) => {
    mkdirSync(path.join(sourceRoot, 'skills', 'api-smoke'), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', 'api-smoke', 'SKILL.md'), `---\nname: api-smoke\ndescription: API smoke\n---\n# API Smoke\n`);
  });
  const discovered = await app.inject({ method: 'POST', url: '/api/discover', payload: { source: sourceRoot } });
  assert.equal(JSON.parse(discovered.body).ok, true);
  const installed = await app.inject({ method: 'POST', url: '/api/install', payload: { source: sourceRoot, subpaths: ['api-smoke'], overwrite: false } });
  assert.equal(JSON.parse(installed.body).ok, true);
  const overwriteBlocked = await app.inject({ method: 'POST', url: '/api/install', payload: { source: sourceRoot, subpaths: ['api-smoke'] } });
  assert.equal(overwriteBlocked.statusCode, 500);
  assert.equal(JSON.parse(overwriteBlocked.body).ok, false);
  const updated = await app.inject({ method: 'POST', url: '/api/update/skills', payload: { skills: ['api-smoke'] } });
  assert.equal(JSON.parse(updated.body).ok, true);
  assert.deepEqual(JSON.parse(updated.body).data.updated, ['api-smoke']);
  const distributed = await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['api-smoke'], agents: ['zed'] } });
  assert.equal(JSON.parse(distributed.body).ok, true);
  const after = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
  assert.equal(after.updateCount, 0); // fresh install matches its source
  assert.deepEqual(after.skills[0].distributedAgents, ['zed']);
  const { appendFileSync } = await import('node:fs');
  appendFileSync(path.join(sourceRoot, 'skills', 'api-smoke', 'SKILL.md'), '\n# v2\n');
  const drifted = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
  assert.equal(drifted.skills[0].hasUpdate, true);
  assert.equal(drifted.updateCount, 1);
  const removed = await app.inject({ method: 'POST', url: '/api/undistribute', payload: { to: 'user', skills: ['api-smoke'], agents: ['zed'] } });
  assert.equal(JSON.parse(removed.body).ok, true);

  // Reverse import via the dashboard: preview is a dry-run; apply resolves clashes.
  const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
  const userHome = path.join(temp, 'user-home');
  mk(path.join(userHome, '.claude', 'skills', 'runtime-skill'), { recursive: true });
  wf(path.join(userHome, '.claude', 'skills', 'runtime-skill', 'SKILL.md'), `---\nname: runtime-skill\ntitle: Runtime Skill\n---\n# Runtime\n`);
  const previewed = JSON.parse((await app.inject({ method: 'POST', url: '/api/init/preview', payload: {} })).body);
  assert.equal(previewed.ok, true);
  assert.equal(previewed.data.dryRun, true);
  assert.deepEqual(previewed.data.discovered.map((skill) => skill.name), ['runtime-skill']);
  const imported = JSON.parse((await app.inject({ method: 'POST', url: '/api/init/apply', payload: { resolve: {} } })).body);
  assert.equal(imported.ok, true);
  assert.deepEqual(imported.data.imported, ['runtime-skill']);
  const afterImport = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
  assert.ok(afterImport.skills.some((skill) => skill.name === 'runtime-skill'));

  await app.close();
  console.log('dashboard api smoke test passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
