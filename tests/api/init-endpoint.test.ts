import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

let root: string;
let home: string;
let userHome: string;
let app: ReturnType<typeof createDashboardApp>;

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'init-api-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
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
});

afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

function writeRuntime(agentRelativeDir: string, name: string, title: string) {
  const dir = path.join(userHome, agentRelativeDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ntitle: ${title}\n---\n# ${name}\n`);
}

describe('POST /api/init (conflict priority)', () => {
  it('preview reports a clash; apply with prefer imports the winning copy', async () => {
    writeRuntime('.claude/skills', 'alpha', 'claude copy');
    writeRuntime('.cursor/skills', 'alpha', 'cursor copy');

    const preview = await app.inject({ method: 'POST', url: '/api/init/preview', payload: {} });
    expect(preview.statusCode).toBe(200);
    const planned = JSON.parse(preview.body).data;
    expect(planned.conflicts.map((conflict: { skill: string }) => conflict.skill)).toEqual(['alpha']);
    expect(planned.imported).toEqual([]);

    const applied = await app.inject({ method: 'POST', url: '/api/init/apply', payload: { prefer: ['claude-code'] } });
    expect(applied.statusCode).toBe(200);
    const result = JSON.parse(applied.body).data;
    expect(result.imported).toEqual(['alpha']);
    expect(result.choices).toEqual({ alpha: path.join(userHome, '.claude', 'skills') });
    expect(readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toContain('claude copy');
  });

  it('preview with prefer shows the planned winner without writing', async () => {
    writeRuntime('.claude/skills', 'alpha', 'claude copy');
    writeRuntime('.cursor/skills', 'alpha', 'cursor copy');

    const preview = await app.inject({ method: 'POST', url: '/api/init/preview', payload: { prefer: ['cursor'] } });
    const planned = JSON.parse(preview.body).data;
    expect(planned.dryRun).toBe(true);
    expect(planned.imported).toEqual(['alpha']);
    expect(planned.conflicts).toEqual([]);
    expect(planned.choices).toEqual({ alpha: path.join(userHome, '.cursor', 'skills') });
    expect(() => readFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'))).toThrow();
  });
});
