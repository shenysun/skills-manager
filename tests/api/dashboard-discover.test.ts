import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDashboardApp } from '../../src/dashboard/server/main.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import type { SkillHomeResolution } from '../../src/core/services/skill-home-resolver.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { skillMarkdown, buildZip, writeZip } from '../fixtures/archives.js';
import { materializingGit } from '../fixtures/git-transport.js';
import { fakeHttp, type FakeHttpRoutes } from '../fixtures/fake-http.js';

// Add-wizard source-input parity (source-formats ticket 08): the wizard posts
// the same free-text string the CLI takes, and the server-side /api/discover
// dispatch must transport every new source kind unchanged.

const V2_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const INDEX_URL = 'https://mp-site.example/.well-known/agent-skills/index.json';

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wizard-discover-'));
  home = path.join(root, 'home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function sha256(data: string | Buffer): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function appWith(routes: FakeHttpRoutes, git = materializingGit(path.join(root, 'nonexistent-upstream'))) {
  const services = createCoreServices({
    skillHomeRoot: home,
    projectRoot: root,
    fs: createNodeFileSystem(),
    git,
    processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
    tempRoot: path.join(root, 'tmp'),
    userHome: path.join(root, 'user'),
    env: {},
    catalogSnapshot: fixtureSnapshot(),
    http: fakeHttp(routes),
  });
  services.skillHome.ensure();
  const resolution: SkillHomeResolution = { root: home, reason: 'explicit', created: true, exists: true };
  const app = createDashboardApp({
    home,
    cwd: root,
    env: {},
    catalogSnapshot: fixtureSnapshot(),
    port: 0,
    host: '127.0.0.1',
    open: false,
    services: { ...services, resolution },
    http: fakeHttp(routes),
  });
  return app.ready().then(() => app);
}

async function discover(app: Awaited<ReturnType<typeof appWith>>, source: string) {
  const response = await app.inject({ method: 'POST', url: '/api/discover', payload: { source } });
  return { status: response.statusCode, body: JSON.parse(response.body) };
}

function marketplaceUpstream(): string {
  const upstream = path.join(root, 'mp-upstream');
  mkdirSync(path.join(upstream, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(upstream, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      plugins: [
        { name: 'core', source: './plugins/core', skills: ['./skills/alpha', './skills/beta'] },
        { name: 'linked', source: { source: 'git-subdir', repo: 'other/repo', path: 'skills' } },
      ],
    }),
  );
  for (const skill of ['alpha', 'beta']) {
    const dir = path.join(upstream, 'plugins', 'core', 'skills', skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skill}\ntitle: ${skill}\ndescription: ${skill} desc\n---\n# ${skill}\n`);
  }
  return upstream;
}

describe('POST /api/discover transports the four new source kinds (ticket 08)', () => {
  it('discovers a single-SKILL.md url source end to end', async () => {
    const app = await appWith((url) =>
      url === 'https://files.example.com/alpha.md' ? [{ kind: 'bytes', body: skillMarkdown('alpha') }] : [],
    );
    try {
      const { status, body } = await discover(app, 'https://files.example.com/alpha.md');
      expect(status).toBe(200);
      expect(body.data.discovered).toEqual([expect.objectContaining({ name: 'alpha' })]);
    } finally {
      await app.close();
    }
  });

  it('discovers a zip-archive url source end to end', async () => {
    const zip = buildZip([{ name: 'skills/gamma/SKILL.md', data: skillMarkdown('gamma') }]);
    const app = await appWith((url) =>
      url === 'https://files.example.com/pack.zip' ? [{ kind: 'bytes', body: zip }] : [],
    );
    try {
      const { status, body } = await discover(app, 'https://files.example.com/pack.zip');
      expect(status, JSON.stringify(body)).toBe(200);
      expect(body.data.discovered).toEqual([expect.objectContaining({ name: 'gamma' })]);
    } finally {
      await app.close();
    }
  });

  it('discovers a local .zip file path end to end', async () => {
    const zipPath = writeZip(root, 'local-pack.zip', [{ name: 'skills/delta/SKILL.md', data: skillMarkdown('delta') }]);
    const app = await appWith(() => []);
    try {
      const { status, body } = await discover(app, zipPath);
      expect(status).toBe(200);
      expect(body.data.discovered).toEqual([expect.objectContaining({ name: 'delta' })]);
    } finally {
      await app.close();
    }
  });

  it('discovers a well-known index source end to end', async () => {
    const body = skillMarkdown('iota');
    const app = await appWith((url) => {
      if (url === INDEX_URL) {
        return [{ kind: 'bytes', body: JSON.stringify({ $schema: V2_SCHEMA, skills: [{ name: 'iota', description: 'indexed', type: 'skill-md', url: 'files/iota.md', digest: sha256(body) }] }) }];
      }
      if (url === 'https://mp-site.example/.well-known/agent-skills/files/iota.md') return [{ kind: 'bytes', body }];
      return [];
    });
    try {
      const { status, body: payload } = await discover(app, 'https://mp-site.example/skills');
      expect(status, JSON.stringify(payload)).toBe(200);
      expect(payload.data.discovered).toEqual([expect.objectContaining({ name: 'iota' })]);
    } finally {
      await app.close();
    }
  });

  it('discovers a marketplace repo with the two-level plugin view', async () => {
    const upstream = marketplaceUpstream();
    const app = await appWith(() => [], materializingGit(upstream));
    try {
      const { status, body } = await discover(app, 'https://github.com/acme/marketplace.git');
      expect(status).toBe(200);
      expect(body.data.discovered).toEqual([
        expect.objectContaining({ name: 'alpha', plugin: 'core' }),
        expect.objectContaining({ name: 'beta', plugin: 'core' }),
      ]);
      expect(body.data.plugins).toEqual([
        { name: 'core', skills: [{ name: 'alpha', subpath: 'plugins/core/skills/alpha' }, { name: 'beta', subpath: 'plugins/core/skills/beta' }] },
        { name: 'linked', skills: [], unsupported: 'git-subdir' },
      ]);
    } finally {
      await app.close();
    }
  });

  it('answers a non-marketplace source with plugins: null', async () => {
    const app = await appWith((url) =>
      url === 'https://files.example.com/alpha.md' ? [{ kind: 'bytes', body: skillMarkdown('alpha') }] : [],
    );
    try {
      const { body } = await discover(app, 'https://files.example.com/alpha.md');
      expect(body.data.plugins).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('installs a plain-http url source once the wizard passes the US-12 confirmation', async () => {
    const app = await appWith((url) =>
      url === 'http://files.example.com/alpha.md' ? [{ kind: 'bytes', body: skillMarkdown('alpha') }] : [],
    );
    try {
      const refused = await discover(app, 'http://files.example.com/alpha.md');
      expect(refused.body.error.code).toBe('insecure_http_unconfirmed');
      const confirmed = await app.inject({
        method: 'POST',
        url: '/api/discover',
        payload: { source: 'http://files.example.com/alpha.md', allowInsecureHttp: true },
      });
      expect(confirmed.statusCode).toBe(200);
      expect(JSON.parse(confirmed.body).data.discovered).toEqual([expect.objectContaining({ name: 'alpha' })]);
    } finally {
      await app.close();
    }
  });
});

describe('POST /api/discover format escape hatch (ticket 08: the wizard selector channel)', () => {
  it('rejects a mislabeled .zip URL whose payload is markdown', async () => {
    const app = await appWith((url) =>
      url === 'https://files.example.com/mislabeled.zip' ? [{ kind: 'bytes', body: skillMarkdown('epsilon') }] : [],
    );
    try {
      const { body } = await discover(app, 'https://files.example.com/mislabeled.zip');
      expect(body.ok).toBe(false);
      expect(body.error.code).toBe('url_payload_mismatch');
    } finally {
      await app.close();
    }
  });

  it('installs it when the retry names the real format', async () => {
    const app = await appWith((url) =>
      url === 'https://files.example.com/mislabeled.zip' ? [{ kind: 'bytes', body: skillMarkdown('epsilon') }] : [],
    );
    try {
      const discoverResponse = await app.inject({
        method: 'POST',
        url: '/api/discover',
        payload: { source: 'https://files.example.com/mislabeled.zip', format: 'md' },
      });
      expect(discoverResponse.statusCode).toBe(200);
      const payload = JSON.parse(discoverResponse.body);
      expect(payload.data.discovered).toEqual([expect.objectContaining({ name: 'epsilon' })]);
    } finally {
      await app.close();
    }
  });

  it('carries the format through /api/install to a full install', async () => {
    const app = await appWith((url) =>
      url === 'https://files.example.com/mislabeled.zip' ? [{ kind: 'bytes', body: skillMarkdown('epsilon') }] : [],
    );
    try {
      const install = await app.inject({
        method: 'POST',
        url: '/api/install',
        payload: { source: 'https://files.example.com/mislabeled.zip', subpaths: ['skills/epsilon'], format: 'md', overwrite: true },
      });
      expect(install.statusCode).toBe(200);
      expect(JSON.parse(install.body).data.installed).toEqual(['epsilon']);
    } finally {
      await app.close();
    }
  });
});

describe('GET /api/state url-source detection (ticket 08: real status for url skills)', () => {
  const SKILL_URL = 'https://files.example.com/zeta.md';

  function stateRoutes(content: string, etag: string): FakeHttpRoutes {
    return (url) => {
      if (url === SKILL_URL) return [{ kind: 'bytes', body: content, headers: { etag } }];
      return [];
    };
  }

  it('reports header-unchanged as no update and header-changed as an update', async () => {
    const before = skillMarkdown('zeta', 'first edition');
    const after = skillMarkdown('zeta', 'second edition');
    let routes = stateRoutes(before, '"v1"');
    let app = await appWith(routes);
    try {
      const install = await app.inject({
        method: 'POST',
        url: '/api/install',
        payload: { source: SKILL_URL, subpaths: ['skills/zeta'], overwrite: true },
      });
      expect(install.statusCode).toBe(200);

      // Header unchanged since install: the probe skips the payload, no update.
      let state = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
      expect(state.skills.find((s: { name: string }) => s.name === 'zeta')).toMatchObject({ hasUpdate: false, detection: 'ok' });

      // Header changed AND the payload changed: the row must read updatable.
      routes = stateRoutes(after, '"v2"');
      await app.close();
      app = await appWith(routes);
      state = JSON.parse((await app.inject({ method: 'GET', url: '/api/state' })).body).data;
      expect(state.skills.find((s: { name: string }) => s.name === 'zeta')).toMatchObject({ hasUpdate: true, detection: 'ok' });
    } finally {
      await app.close();
    }
  });
});
