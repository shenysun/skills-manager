import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

let root: string;
let home: string;
let userHome: string;
let app: ReturnType<typeof createDashboardApp>;

const SKILL_MD = [
  '---',
  'name: alpha',
  'description: preview fixture',
  '---',
  '# Alpha',
  '',
  'Body text.',
  '',
].join('\n');

function seedSkill(name: string, files: Record<string, string>) {
  mkdirSync(path.join(home, 'skills', name), { recursive: true });
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(home, 'skills', name, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'skill-file-api-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user-home');
  mkdirSync(path.join(userHome, '.claude'), { recursive: true });
  seedSkill('alpha', { 'SKILL.md': SKILL_MD });
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

describe('GET /api/skill/file (markdown pipeline)', () => {
  it('returns rendered markdown for a .md file: kind, html, raw, truncated', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=alpha&path=SKILL.md' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.kind).toBe('markdown');
    expect(body.data.html).toContain('<h1>Alpha</h1>');
    expect(body.data.raw).toBe(SKILL_MD);
    expect(body.data.truncated).toBe(false);
  });

  it('strips the frontmatter block from html but keeps it in raw', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=alpha&path=SKILL.md' });
    const body = JSON.parse(response.body);
    expect(body.data.html).not.toContain('name: alpha');
    expect(body.data.html).not.toContain('preview fixture');
    expect(body.data.html).toContain('<h1>Alpha</h1>');
    expect(body.data.raw).toContain('name: alpha');
  });

  it('highlights fenced code blocks via Shiki with dual-theme CSS variables', async () => {
    seedSkill('codey', { 'SKILL.md': '# Codey\n\n```js\nconst answer = 42;\n```\n' });
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=codey&path=SKILL.md' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.html).toContain('shiki');
    // One DOM carrying both palettes: CSS variables, switched purely by CSS.
    expect(body.data.html).toContain('--shiki-light');
    expect(body.data.html).toContain('--shiki-dark');
    expect((body.data.html.match(/<pre/g) || []).length).toBe(1);
  });

  it('sanitizes hostile inline HTML: scripts, error handlers, javascript: links', async () => {
    seedSkill('evil', {
      'SKILL.md': [
        '# Evil',
        '',
        '<script>alert("xss")</script>',
        '',
        '<img src="x.png" onerror="alert(\'img\')" />',
        '',
        '[click me](javascript:alert("link"))',
        '',
      ].join('\n'),
    });
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=evil&path=SKILL.md' });
    expect(response.statusCode).toBe(200);
    const html = JSON.parse(response.body).data.html as string;
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    // The javascript: link is neutralized — never a clickable href (markdown-it
    // degrades it to plain text; DOMPurify would strip the href if it slipped).
    expect(html).not.toMatch(/href\s*=\s*["']?\s*javascript:/i);
    // Benign content survives the sanitizer.
    expect(html).toContain('<h1>Evil</h1>');
  });

  it('truncates content over the 512KB cap at the byte boundary and flags it', async () => {
    seedSkill('big', { 'SKILL.md': '# Big\n\n' + 'x'.repeat(600 * 1024) });
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=big&path=SKILL.md' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.data.truncated).toBe(true);
    // ASCII bytes map 1:1 to characters: the cut lands exactly at the cap.
    expect(body.data.raw.length).toBe(512 * 1024);
  });
});

describe('GET /api/skill/file (path safety)', () => {
  it('404s when the skill does not exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=ghost&path=SKILL.md' });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('skill_not_found');
  });

  it('404s when the path does not exist inside the skill', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=alpha&path=nope.md' });
    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('file_not_found');
  });

  it('403s on an invalid skill name', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/skill/file?name=${encodeURIComponent('../evil')}&path=SKILL.md` });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('invalid_skill_name');
  });

  it('403s on a traversal path escaping the skill directory', async () => {
    writeFileSync(path.join(home, 'outside.md'), '# Outside\n');
    const response = await app.inject({ method: 'GET', url: `/api/skill/file?name=alpha&path=${encodeURIComponent('../../outside.md')}` });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('path_escape');
  });

  it('403s when a symlink inside the skill points outside it', async () => {
    writeFileSync(path.join(home, 'secret.md'), '# Secret\n');
    symlinkSync(path.join(home, 'secret.md'), path.join(home, 'skills', 'alpha', 'leak.md'));
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=alpha&path=leak.md' });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe('path_escape');
  });
});

describe('GET /api/skill/files (file tree enumeration)', () => {
  it('lists every file as sorted relative paths with sizes', async () => {
    seedSkill('tree', {
      'SKILL.md': '# Tree\n',
      'docs/guide.md': 'Guide\n',
      'agents/vendor/lib/deep.mjs': 'export {}\n',
      'run.sh': 'echo hi\n',
    });
    const response = await app.inject({ method: 'GET', url: '/api/skill/files?name=tree' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.files.map((f: { path: string }) => f.path)).toEqual([
      'SKILL.md',
      'agents/vendor/lib/deep.mjs',
      'docs/guide.md',
      'run.sh',
    ]);
    expect(body.data.files.find((f: { path: string }) => f.path === 'run.sh').size).toBe('echo hi\n'.length);
  });

  it('404s when the skill does not exist', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/skill/files?name=ghost' });
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe('skill_not_found');
  });

  it('403s on an invalid skill name', async () => {
    const response = await app.inject({ method: 'GET', url: `/api/skill/files?name=${encodeURIComponent('../evil')}` });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe('invalid_skill_name');
  });
});

describe('GET /api/skill/file (source / text / binary kinds)', () => {
  it('returns highlighted source for whitelisted language extensions', async () => {
    seedSkill('src', { 'SKILL.md': '# S\n', 'app.mjs': 'export const x = 1;\n', 'run.sh': 'echo hi\n' });
    const response = await app.inject({ method: 'GET', url: '/api/skill/file?name=src&path=app.mjs' });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.ok).toBe(true);
    expect(body.data.kind).toBe('source');
    expect(body.data.html).toContain('shiki');
    expect(body.data.html).toContain('--shiki-light');
    expect(body.data.html).not.toContain('onerror'); // sanitized like markdown
    expect(body.data.truncated).toBe(false);
    expect('raw' in body.data).toBe(false);
  });

  it('returns plain text for non-whitelisted text extensions and extensionless files', async () => {
    seedSkill('txt', { 'SKILL.md': '# T\n', 'pnpm.lock': 'lockfileVersion\n', 'Makefile': 'build:\n' });
    const lock = JSON.parse((await app.inject({ method: 'GET', url: '/api/skill/file?name=txt&path=pnpm.lock' })).body);
    expect(lock.data.kind).toBe('text');
    expect(lock.data.raw).toBe('lockfileVersion\n');
    expect(lock.data.truncated).toBe(false);

    const make = JSON.parse((await app.inject({ method: 'GET', url: '/api/skill/file?name=txt&path=Makefile' })).body);
    expect(make.data.kind).toBe('text');
    expect(make.data.raw).toBe('build:\n');
  });

  it('classifies files with NUL bytes or invalid UTF-8 as binary with size only', async () => {
    seedSkill('bin', { 'SKILL.md': '# B\n' });
    const skillRoot = path.join(home, 'skills', 'bin');
    writeFileSync(path.join(skillRoot, 'blob.bin'), Buffer.from([0x61, 0x00, 0x62, 0x63]));
    writeFileSync(path.join(skillRoot, 'weird.txt'), Buffer.from([0xff, 0xfe, 0xfd]));

    const blob = JSON.parse((await app.inject({ method: 'GET', url: '/api/skill/file?name=bin&path=blob.bin' })).body);
    expect(blob.data.kind).toBe('binary');
    expect(blob.data.size).toBe(4);
    expect('raw' in blob.data).toBe(false);
    expect('html' in blob.data).toBe(false);

    const weird = JSON.parse((await app.inject({ method: 'GET', url: '/api/skill/file?name=bin&path=weird.txt' })).body);
    expect(weird.data.kind).toBe('binary');
  });

  it('truncates source and text files over the 512KB cap', async () => {
    seedSkill('big2', { 'SKILL.md': '# B\n', 'huge.js': '// ' + 'y'.repeat(600 * 1024) + '\n' });
    const js = JSON.parse((await app.inject({ method: 'GET', url: '/api/skill/file?name=big2&path=huge.js' })).body);
    expect(js.data.kind).toBe('source');
    expect(js.data.truncated).toBe(true);
  });
});
