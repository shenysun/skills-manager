import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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
  // Create test structure under process.cwd() to avoid security restrictions
  const tempBase = path.join(process.cwd(), '.test-browse-tmp');
  root = mkdtempSync(tempBase);
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
  mkdirSync(path.join(userHome, '.claude'), { recursive: true });

  // Create test directory structure
  mkdirSync(path.join(root, 'projects', 'app-a'), { recursive: true });
  mkdirSync(path.join(root, 'projects', 'app-b'), { recursive: true });
  mkdirSync(path.join(root, 'projects', 'app-a', 'src'), { recursive: true });

  app = createDashboardApp({
    home,
    cwd: root,
    env: { HOME: userHome },
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

describe('GET /api/fs/browse (directory browser)', () => {
  it('lists subdirectories from a given path', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${encodeURIComponent(path.join(root, 'projects'))}`,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.path).toBe(path.join(root, 'projects'));
    expect(body.data.entries).toContainEqual(expect.objectContaining({ name: 'app-a' }));
    expect(body.data.entries).toContainEqual(expect.objectContaining({ name: 'app-b' }));
    expect(body.data.entries.some((e: any) => e.name === 'app-a')).toBe(true);
  });

  it('returns parent path when not at root', async () => {
    const projectsPath = path.join(root, 'projects', 'app-a');
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${encodeURIComponent(projectsPath)}`,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.parent).toBe(path.join(root, 'projects'));
  });

  it('sets parent to null at home', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${encodeURIComponent(userHome)}`,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.parent).toBeNull();
  });

  it('defaults to home when no path provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse`,
    });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.path).toBe(userHome);
  });

  it('filters to only directories, sorted by name', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${encodeURIComponent(path.join(root, 'projects'))}`,
    });
    const body = JSON.parse(response.body);
    const names = body.data.entries.map((e: any) => e.name);
    expect(names).toEqual(['app-a', 'app-b']); // sorted
    expect(names).not.toContain('not-a-directory');
  });

  it('rejects access outside allowed bounds', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=/etc`,
    });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('browse_forbidden');
  });

  it('returns 400 for file paths (not directories)', async () => {
    // Use a file that exists in the test root instead of a fake path
    const userHomePath = userHome;
    const response = await app.inject({
      method: 'GET',
      url: `/api/fs/browse?path=${encodeURIComponent(userHomePath)}/non-existent-file`,
    });
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
  });
});
