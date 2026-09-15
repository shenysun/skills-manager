import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitCloneOptions, GitPort } from '../../src/core/ports/git.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';
import { materializingGit } from '../fixtures/git-transport.js';

const SHA = 'fedcba9876543210fedcba9876543210fedcba98';
const TREE = '0123456789abcdef0123456789abcdef01234567';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'source-service-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type CloneCall = { repoUrl: string; destination: string; options?: GitCloneOptions };

function spyGit(commit = SHA) {
  const cloneCalls: CloneCall[] = [];
  const git: GitPort = {
    clone: (repoUrl, destination, options) => {
      cloneCalls.push({ repoUrl, destination, options });
    },
    revParseHead: () => commit,
    revParseTree: () => TREE,
    listRemoteHeads: () => ['develop', 'main'],
    statusShort: () => '',
    log: () => [],
  };
  return { git, cloneCalls };
}

function service(git: GitPort) {
  return new SourceService(createNodeFileSystem(), git, path.join(root, 'tmp'));
}

describe('SourceService.checkout passes shallow-clone intent (ADR-0013)', () => {
  it('sends an empty intent for a ref-less GitHub source — depth mapping is the adapter job', () => {
    const { git, cloneCalls } = spyGit();
    const checkout = service(git).checkout('https://github.com/owner/repo.git');
    expect(cloneCalls).toHaveLength(1);
    expect(cloneCalls[0].repoUrl).toBe('https://github.com/owner/repo.git');
    expect(cloneCalls[0].options).toEqual({});
    expect(checkout.commit).toBe(SHA);
  });

  it('forwards a branch/tag forced ref as clone intent', () => {
    const { git, cloneCalls } = spyGit();
    service(git).checkout('https://github.com/owner/repo.git', 'v1.2.0');
    expect(cloneCalls[0].options).toEqual({ ref: 'v1.2.0' });
  });

  it('forwards a bare commit SHA forced ref verbatim — the adapter discriminates, not the domain', () => {
    const { git, cloneCalls } = spyGit();
    service(git).checkout('https://github.com/owner/repo.git', SHA);
    expect(cloneCalls[0].options).toEqual({ ref: SHA });
  });

  it('keeps ls-remote ref resolution for GitHub tree URLs and forwards the resolved branch', () => {
    const { git, cloneCalls } = spyGit();
    const checkout = service(git).checkout('https://github.com/owner/repo/tree/main/skills/alpha');
    expect(cloneCalls[0].options).toEqual({ ref: 'main' });
    expect(checkout.baseSubpath).toBe('skills/alpha');
  });

  it('routes bare non-GitHub git URLs through the same single clone path', () => {
    const { git, cloneCalls } = spyGit();
    service(git).checkout('https://gitlab.com/owner/repo.git', 'main');
    expect(cloneCalls).toHaveLength(1);
    expect(cloneCalls[0].repoUrl).toBe('https://gitlab.com/owner/repo.git');
    expect(cloneCalls[0].options).toEqual({ ref: 'main' });
  });

  it('does not clone local sources', () => {
    const { git, cloneCalls } = spyGit();
    const local = path.join(root, 'local-repo');
    mkdirSync(path.join(local, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(local, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n# a\n');
    const checkout = service(git).checkout(local);
    expect(cloneCalls).toHaveLength(0);
    expect(checkout.repoDir).toBe(local);
  });
});

describe('normalize dispatches the source kind (source-formats ticket 01)', () => {
  it('dispatches a local path to kind local', () => {
    const { git } = spyGit();
    const local = path.join(root, 'local-repo');
    mkdirSync(local, { recursive: true });
    expect(service(git).normalize(local).kind).toBe('local');
  });

  it('dispatches every git-recognized remote input to kind git', () => {
    const { git } = spyGit();
    const s = service(git);
    for (const input of [
      'owner/repo',
      'https://github.com/owner/repo.git',
      'https://github.com/owner/repo/tree/main/skills/alpha',
      'https://gitlab.com/owner/repo.git',
    ]) {
      expect(s.normalize(input).kind).toBe('git');
    }
  });
});

describe('upstreamTree anchors per dispatched kind (ADR-0016)', () => {
  function checkoutOf(kind: SourceCheckout['kind']): SourceCheckout {
    return { input: 'unused', repoUrl: 'https://example.com/repo', kind, repoDir: path.join(root, 'repo'), commit: SHA };
  }

  it('leaves url, wellknown and archive checkouts unanchored', () => {
    const { git } = spyGit();
    const s = service(git);
    for (const kind of ['url', 'wellknown', 'archive'] as const) {
      expect(s.upstreamTree(checkoutOf(kind), 'skills/alpha')).toBeNull();
    }
  });

  it('anchors a marketplace checkout on the skill sub-directory tree SHA, like git', () => {
    const revParseTreeCalls: Array<{ repoDir: string; subpath: string }> = [];
    const git: GitPort = {
      ...spyGit().git,
      revParseTree: (repoDir, subpath) => {
        revParseTreeCalls.push({ repoDir, subpath });
        return TREE;
      },
    };
    const s = service(git);
    expect(s.upstreamTree(checkoutOf('marketplace'), 'skills/alpha')).toBe(TREE);
    expect(revParseTreeCalls).toEqual([{ repoDir: path.join(root, 'repo'), subpath: 'skills/alpha' }]);
  });

  it('anchors a marketplace repo-root skill on the commit SHA, like git', () => {
    const { git } = spyGit();
    const s = service(git);
    expect(s.upstreamTree(checkoutOf('marketplace'), '')).toBe(SHA);
  });
});

describe('marketplace detection (source-formats ticket 06)', () => {
  function marketplaceUpstream(): string {
    const upstream = path.join(root, 'mp-upstream');
    mkdirSync(path.join(upstream, '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(upstream, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name: 'test-mp', plugins: [] }));
    return upstream;
  }

  it('detects a root marketplace manifest after clone and switches kind to marketplace', () => {
    const git = materializingGit(marketplaceUpstream());
    const checkout = service(git).checkout('https://github.com/owner/repo.git');
    expect(checkout.kind).toBe('marketplace');
  });

  it('keeps kind git when the root has no manifest', () => {
    const upstream = path.join(root, 'plain-upstream');
    mkdirSync(upstream, { recursive: true });
    const checkout = service(materializingGit(upstream)).checkout('https://github.com/owner/repo.git');
    expect(checkout.kind).toBe('git');
  });

  it('keeps kind git for an explicit-subpath source even with a root manifest (bypass path, US-18)', () => {
    const git = materializingGit(marketplaceUpstream());
    const checkout = service(git).checkout('https://github.com/owner/repo/tree/main/plugins/foo');
    expect(checkout.kind).toBe('git');
    expect(checkout.baseSubpath).toBe('plugins/foo');
  });
});

describe('marketplace discovery (source-formats ticket 06)', () => {
  const MANIFEST = {
    name: 'test-mp',
    plugins: [
      { name: 'core', source: './plugins/core', description: 'core plugin', skills: ['./skills/alpha', './skills/beta'] },
      { name: 'linked', source: { source: 'git-subdir', repo: 'other/repo', path: 'skills' } },
      { name: 'remote', source: { source: 'url', url: 'https://example.com/plugin' } },
      { name: 'bare', source: './plugins/bare' },
      { name: 'commands-only', source: './plugins/commands-only', commands: ['./commands'] },
    ],
  };

  function marketplaceUpstream(): string {
    const upstream = path.join(root, 'mp-discovery');
    mkdirSync(path.join(upstream, '.claude-plugin'), { recursive: true });
    writeFileSync(path.join(upstream, '.claude-plugin', 'marketplace.json'), JSON.stringify(MANIFEST));
    for (const skill of ['alpha', 'beta']) {
      const dir = path.join(upstream, 'plugins', 'core', 'skills', skill);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skill}\ntitle: ${skill} title\ndescription: ${skill} desc\n---\n# ${skill}\n`);
    }
    mkdirSync(path.join(upstream, 'plugins', 'bare'), { recursive: true });
    mkdirSync(path.join(upstream, 'plugins', 'commands-only', 'commands'), { recursive: true });
    return upstream;
  }

  function checkoutOf(upstream: string) {
    const git = materializingGit(upstream);
    return { git, checkout: service(git).checkout('https://github.com/owner/repo.git') };
  }

  it('expands form-1 plugins into discovered skills tagged with their plugin', () => {
    const { git, checkout } = checkoutOf(marketplaceUpstream());
    expect(checkout.kind).toBe('marketplace');
    const discovered = service(git).discover(checkout);
    expect(discovered.map((skill) => ({ name: skill.name, plugin: skill.plugin, subpath: skill.subpath })))
      .toEqual([
        { name: 'alpha', plugin: 'core', subpath: 'plugins/core/skills/alpha' },
        { name: 'beta', plugin: 'core', subpath: 'plugins/core/skills/beta' },
      ]);
  });

  it('ignores plugins without a skills[] entry and non-skill content entirely', () => {
    const { git, checkout } = checkoutOf(marketplaceUpstream());
    const names = service(git).discover(checkout).map((skill) => skill.plugin);
    expect(names).toEqual(['core', 'core']);
  });

  it('exposes a two-level marketplace view: consumable plugin with its skills, unsupported forms with a reason', () => {
    const { git, checkout } = checkoutOf(marketplaceUpstream());
    const view = service(git).marketplaceView(checkout, service(git).discover(checkout));
    expect(view).not.toBeNull();
    expect(view!.plugins).toContainEqual({ name: 'core', skills: [{ name: 'alpha', subpath: 'plugins/core/skills/alpha' }, { name: 'beta', subpath: 'plugins/core/skills/beta' }] });
    expect(view!.plugins).toContainEqual({ name: 'linked', skills: [], unsupported: 'git-subdir' });
    expect(view!.plugins).toContainEqual({ name: 'remote', skills: [], unsupported: 'url' });
    expect(view!.plugins.map((plugin) => plugin.name)).not.toContain('bare');
  });

  it('returns a null view for ordinary git checkouts', () => {
    const upstream = path.join(root, 'plain-mp');
    mkdirSync(upstream, { recursive: true });
    const { git, checkout } = checkoutOf(upstream);
    expect(service(git).marketplaceView(checkout, [])).toBeNull();
  });

  it('refuses manifest skill paths that escape the repo (untrusted manifest)', () => {
    const upstream = path.join(root, 'mp-escape');
    mkdirSync(path.join(upstream, '.claude-plugin'), { recursive: true });
    writeFileSync(
      path.join(upstream, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ plugins: [{ name: 'evil', source: './plugins/evil', skills: ['../../../outside'] }] }),
    );
    mkdirSync(path.join(upstream, 'plugins', 'evil'), { recursive: true });
    const { git, checkout } = checkoutOf(upstream);
    expect(() => service(git).discover(checkout)).toThrow(/Path escape blocked/);
  });

  it('drops plugins whose source path is stale instead of poisoning the whole marketplace', () => {
    const upstream = path.join(root, 'mp-stale');
    mkdirSync(path.join(upstream, '.claude-plugin'), { recursive: true });
    mkdirSync(path.join(upstream, 'plugins', 'alive', 'skills', 'ok'), { recursive: true });
    writeFileSync(path.join(upstream, 'plugins', 'alive', 'skills', 'ok', 'SKILL.md'), '---\nname: ok\n---\n# ok\n');
    writeFileSync(
      path.join(upstream, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        plugins: [
          { name: 'ghost', source: './plugins/ghost', skills: ['./skills/x'] },
          { name: 'half', source: './plugins/alive', skills: ['./skills/ok', './skills/vanished'] },
        ],
      }),
    );
    const { git, checkout } = checkoutOf(upstream);
    const discovered = service(git).discover(checkout);
    expect(discovered.map((skill) => skill.name)).toEqual(['ok']);
    expect(discovered[0].plugin).toBe('half');
  });

  it('scans an explicit-subpath source as an ordinary git source inside the subtree (US-18 bypass)', () => {
    const upstream = marketplaceUpstream();
    mkdirSync(path.join(upstream, 'plugins', 'bare', 'skills', 'deep'), { recursive: true });
    writeFileSync(path.join(upstream, 'plugins', 'bare', 'skills', 'deep', 'SKILL.md'), '---\nname: deep\n---\n# deep\n');
    const git = materializingGit(upstream);
    const checkout = service(git).checkout('https://github.com/owner/repo/tree/main/plugins/bare');
    expect(checkout.kind).toBe('git');
    const discovered = service(git).discover(checkout);
    expect(discovered.map((skill) => skill.name)).toEqual(['deep']);
    expect(service(git).marketplaceView(checkout, discovered)).toBeNull();
  });
});

describe('install after a shallow clone', () => {
  it('still records upstream_commit from rev-parse HEAD', () => {
    const upstream = path.join(root, 'upstream');
    mkdirSync(path.join(upstream, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(upstream, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ntitle: Alpha\ndescription: d\n---\n# Alpha\n');

    const cloneCalls: CloneCall[] = [];
    // Fake transport: "clone" materializes the upstream working tree — a shallow clone has no history to fake.
    const git: GitPort = {
      clone: (repoUrl, destination, options) => {
        cloneCalls.push({ repoUrl, destination, options });
        cpSync(upstream, destination, { recursive: true });
      },
      revParseHead: () => SHA,
      revParseTree: () => TREE,
      listRemoteHeads: () => [],
      statusShort: () => '',
      log: () => [],
    };
    const fakeRunner = { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never;

    const s = createCoreServices({
      skillHomeRoot: path.join(root, 'home'),
      projectRoot: root,
      fs: createNodeFileSystem(),
      git,
      processRunner: fakeRunner,
      tempRoot: path.join(root, 'tmp'),
      userHome: path.join(root, 'user'),
      env: {},
      catalogSnapshot: fixtureSnapshot(),
    });
    s.skillHome.ensure();
    s.install.installFromSourceSelection({ source: 'https://github.com/owner/repo.git', selectors: ['skills/alpha'] });

    expect(cloneCalls).toHaveLength(1);
    expect(cloneCalls[0].options).toEqual({});
    expect(s.registry.load().skills.alpha?.source?.upstream_commit).toBe(SHA);
    expect(s.registry.load().skills.alpha?.source?.upstream_tree).toBe(TREE);
  });
});

describe('SourceService temp lifecycle (manager-skill-first ticket 02)', () => {
  it('withCheckout removes the git temp dir after the callback returns', () => {
    const { git } = spyGit();
    const s = service(git);
    let repoDir = '';
    const result = s.withCheckout('https://github.com/owner/repo.git', undefined, (checkout) => {
      repoDir = checkout.repoDir;
      expect(createNodeFileSystem().kind(path.dirname(repoDir))).toBe('directory');
      return 'used';
    });
    expect(result).toBe('used');
    expect(createNodeFileSystem().kind(path.dirname(repoDir))).toBe('missing');
  });

  it('withCheckout removes the git temp dir even when the callback throws, and rethrows', () => {
    const { git } = spyGit();
    const s = service(git);
    let repoDir = '';
    expect(() =>
      s.withCheckout('https://github.com/owner/repo.git', undefined, (checkout) => {
        repoDir = checkout.repoDir;
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(createNodeFileSystem().kind(path.dirname(repoDir))).toBe('missing');
  });

  it('withCheckout leaves a local source directory untouched', () => {
    const { git } = spyGit();
    const local = path.join(root, 'local-source');
    mkdirSync(local, { recursive: true });
    const s = service(git);
    s.withCheckout(local, undefined, (checkout) => {
      expect(checkout.isLocal).toBe(true);
    });
    expect(createNodeFileSystem().kind(local)).toBe('directory');
  });

  it('checkout sweeps orphaned skills-source-<uuid> dirs older than 24h but keeps fresh ones', () => {
    const { git } = spyGit();
    const s = service(git);
    const tempRoot = path.join(root, 'tmp');
    const stale = path.join(tempRoot, 'skills-source-1b671a64-40d5-491e-b99d-42e4c0519011');
    const fresh = path.join(tempRoot, 'skills-source-2c782b75-51e6-4a2f-ca0e-53f5d1620222');
    mkdirSync(stale, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(stale, twoDaysAgo, twoDaysAgo);

    s.checkout('https://github.com/owner/repo.git');

    expect(createNodeFileSystem().kind(stale)).toBe('missing');
    expect(createNodeFileSystem().kind(fresh)).toBe('directory');
  });

  it('sweep never touches a same-prefix dir this tool could not have created (adversary M5)', () => {
    const { git } = spyGit();
    const s = service(git);
    const tempRoot = path.join(root, 'tmp');
    const foreign = path.join(tempRoot, 'skills-source-not-ours');
    mkdirSync(foreign, { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(foreign, twoDaysAgo, twoDaysAgo);

    s.checkout('https://github.com/owner/repo.git');

    expect(createNodeFileSystem().kind(foreign)).toBe('directory');
  });
});

describe('checkout failure hygiene (adversary H1/H2/M2)', () => {
  it('cleans the temp dir and strips its path from the error when clone fails (H1/M2)', () => {
    let cloneDestination = '';
    const git: GitPort = {
      clone: (_url, destination) => {
        cloneDestination = destination;
        throw new Error(`Command failed: git clone --depth=1 https://github.com/owner/repo.git ${destination}\nfatal: repository not found`);
      },
      revParseHead: () => SHA,
      revParseTree: () => TREE,
      listRemoteHeads: () => [],
      statusShort: () => '',
      log: () => [],
    };
    const s = service(git);
    let thrown: Error | undefined;
    try {
      s.withCheckout('https://github.com/owner/repo.git', undefined, () => 'unused');
    } catch (error) {
      thrown = error as Error;
    }
    // The clone itself failed — temp cleaned (M2) and the machine-local clone
    // path never crosses into the conversation layer (H1).
    expect(thrown?.message).not.toContain(cloneDestination);
    expect(thrown?.message).toContain('<temp-checkout>');
    expect(thrown?.message).toMatch(/fatal: repository not found/);
    expect(createNodeFileSystem().kind(path.dirname(cloneDestination))).toBe('missing');
  });

  it('sweep skips entries it cannot delete instead of failing checkout (H2)', () => {
    const realFs = createNodeFileSystem();
    const tempRoot = path.join(root, 'tmp');
    const poisoned = path.join(tempRoot, 'skills-source-3d893c86-62f7-4b30-db1f-64a6e1730333');
    mkdirSync(poisoned, { recursive: true });
    utimesSync(poisoned, new Date(Date.now() - 48 * 3600_000), new Date(Date.now() - 48 * 3600_000));
    // Proxy (not spread): NodeFileSystem methods live on the prototype.
    const fs: typeof realFs = new Proxy(realFs, {
      get(target, prop, receiver) {
        if (prop === 'removeTree') {
          return (p: string) => {
            if (p === poisoned) throw new Error('EPERM, Operation not permitted');
            return target.removeTree(p);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const { git } = spyGit();
    const s = new SourceService(fs, git, tempRoot);
    // Must not throw despite the undeletable stale entry.
    s.checkout('https://github.com/owner/repo.git');
  });
});
