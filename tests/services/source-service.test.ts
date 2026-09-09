import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitCloneOptions, GitPort } from '../../src/core/ports/git.js';
import { createCoreServices } from '../../src/core/services/index.js';
import { SourceService } from '../../src/core/services/source-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

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

  it('checkout sweeps orphaned skills-source-* dirs older than 24h but keeps fresh ones', () => {
    const { git } = spyGit();
    const s = service(git);
    const tempRoot = path.join(root, 'tmp');
    const stale = path.join(tempRoot, 'skills-source-stale');
    const fresh = path.join(tempRoot, 'skills-source-fresh');
    mkdirSync(stale, { recursive: true });
    mkdirSync(fresh, { recursive: true });
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(stale, twoDaysAgo, twoDaysAgo);

    s.checkout('https://github.com/owner/repo.git');

    expect(createNodeFileSystem().kind(stale)).toBe('missing');
    expect(createNodeFileSystem().kind(fresh)).toBe('directory');
  });
});
