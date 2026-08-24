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
  const bad = await app.inject({ method: 'POST', url: '/api/discover', payload: {} });
  assert.equal(bad.statusCode, 400);

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
  const updates = await app.inject({ method: 'GET', url: '/api/updates' });
  const sourceKey = JSON.parse(updates.body).data.groups[0].key;
  const selectedSourceUpdate = await app.inject({ method: 'POST', url: '/api/update/source', payload: { key: sourceKey, skills: ['api-smoke'] } });
  assert.equal(JSON.parse(selectedSourceUpdate.body).ok, true);
  assert.deepEqual(JSON.parse(selectedSourceUpdate.body).data.updated, ['api-smoke']);
  const doctor = await app.inject({ method: 'GET', url: '/api/doctor' });
  assert.equal(JSON.parse(doctor.body).ok, true);
  assert.equal(JSON.parse(doctor.body).data.distribution.managedEntries, 0);
  const distributed = await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['api-smoke'], agents: ['zed'] } });
  assert.equal(JSON.parse(distributed.body).ok, true);
  const after = await app.inject({ method: 'GET', url: '/api/state' });
  assert.equal(JSON.parse(after.body).data.doctor.distribution.managedEntries, 1);
  assert.ok(JSON.parse(after.body).data.distributions.user);
  await app.close();
  console.log('dashboard api smoke test passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
