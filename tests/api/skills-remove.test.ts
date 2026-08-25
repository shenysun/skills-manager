import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  root = mkdtempSync(path.join(tmpdir(), 'remove-api-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
  for (const name of ['alpha', 'beta']) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: api\n---\n# ${name}\n`);
  }
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
  const install = await app.inject({ method: 'POST', url: '/api/install', payload: { source: sourceRoot, subpaths: ['alpha', 'beta'], overwrite: true } });
  expect(JSON.parse(install.body).ok).toBe(true);
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

function remove(payload: { skills: string[] }) {
  return app.inject({ method: 'POST', url: '/api/skills/remove', payload });
}

async function stateSkills() {
  return JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data.skills as Array<{ name: string; distributedAgents: string[] }>;
}

/** Corrupt one skill's index entry with an unknown agent id so its undistribute fails. */
function breakUndistributeFor(skill: string) {
  const indexFile = path.join(home, '.skills', 'distributions.jsonl');
  const records = readFileSync(indexFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { entries: Array<{ skill: string; agents: string[] }> })
    .map((record) => ({
      ...record,
      entries: record.entries.map((entry) => (entry.skill === skill ? { ...entry, agents: ['not-an-agent'] } : entry)),
    }));
  writeFileSync(indexFile, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
}

describe('POST /api/skills/remove (one-step remove)', () => {
  it('undistributes every known target, then archives the skill', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['zed', 'claude-code'] } });
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'project', projectRoot: path.join(root, 'proj'), skills: ['alpha'], agents: ['codex'] } });
    const response = await remove({ skills: ['alpha'] });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.results).toEqual([{ skill: 'alpha', ok: true, removed: 3 }]);
    // Skill is gone from the library and nothing lingers in runtime dirs.
    expect((await stateSkills()).map((skill) => skill.name)).toEqual(['beta']);
    expect(existsSync(path.join(userHome, '.agents', 'skills', 'alpha'))).toBe(false);
    expect(existsSync(path.join(userHome, '.claude', 'skills', 'alpha'))).toBe(false);
    expect(existsSync(path.join(root, 'proj', '.agents', 'skills', 'alpha'))).toBe(false);
  });

  it('succeeds for a skill with no distributions at all', async () => {
    const response = await remove({ skills: ['beta'] });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.results).toEqual([{ skill: 'beta', ok: true, removed: 0 }]);
    expect((await stateSkills()).map((skill) => skill.name)).toEqual(['alpha']);
  });

  it('reports per-skill failure without rolling back other successes', async () => {
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['alpha'], agents: ['zed'] } });
    await app.inject({ method: 'POST', url: '/api/distribute', payload: { to: 'user', skills: ['beta'], agents: ['zed'] } });
    breakUndistributeFor('beta');
    const response = await remove({ skills: ['alpha', 'beta'] });
    expect(response.statusCode).toBe(200);
    const results = JSON.parse(response.body).data.results;
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ skill: 'alpha', ok: true, removed: 1 });
    expect(results[1].skill).toBe('beta');
    expect(results[1].ok).toBe(false);
    expect(results[1].error.code).toBe('distribute_unknown_agent');
    // alpha's success stands: archived and gone; beta stayed in the library.
    expect((await stateSkills()).map((skill) => skill.name)).toEqual(['beta']);
  });

  it('records the operation in the activity log', async () => {
    await remove({ skills: ['alpha'] });
    const activity = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data.activity as Array<{ action: string }>;
    expect(activity.some((record) => record.action === 'remove')).toBe(true);
  });
});
