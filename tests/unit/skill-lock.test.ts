import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lockEntryToSource, SkillLockService } from '../../src/core/services/skill-lock-service.js';
import { createNodeFileSystem } from '../../src/infra/index.js';

let root: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'skill-lock-'));
  userHome = path.join(root, 'user');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeLock(relative: string, body: unknown) {
  const file = path.join(root, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, typeof body === 'string' ? body : JSON.stringify(body));
}

function service(env: Record<string, string | undefined> = {}) {
  return new SkillLockService(createNodeFileSystem(), { env, userHomeDir: userHome });
}

const githubEntry = {
  source: 'intellectronica/agent-skills',
  sourceType: 'github',
  sourceUrl: 'https://github.com/intellectronica/agent-skills.git',
  skillPath: 'skills/beautiful-mermaid/SKILL.md',
  skillFolderHash: '88651e5cc10e4b028798dcfa45b1c1004e93f8b2',
  installedAt: '2026-02-02T02:58:57.599Z',
  updatedAt: '2026-02-02T02:58:57.599Z',
};

describe('SkillLockService.load (discovery, ADR-0011 decision 4)', () => {
  it('reads the default machine-global lock at <userHome>/.agents/.skill-lock.json', () => {
    writeLock(path.join('user', '.agents', '.skill-lock.json'), { version: 3, skills: { 'beautiful-mermaid': githubEntry } });

    const entries = service().load();

    expect([...entries.keys()]).toEqual(['beautiful-mermaid']);
    expect(entries.get('beautiful-mermaid')).toMatchObject({ sourceUrl: githubEntry.sourceUrl });
  });

  it('prefers $XDG_STATE_HOME/skills/.skill-lock.json when XDG_STATE_HOME is set', () => {
    writeLock(path.join('xdg', 'skills', '.skill-lock.json'), { version: 3, skills: { 'from-xdg': githubEntry } });
    writeLock(path.join('user', '.agents', '.skill-lock.json'), { version: 3, skills: { 'from-home': githubEntry } });

    const entries = service({ XDG_STATE_HOME: path.join(root, 'xdg') }).load();

    expect([...entries.keys()]).toEqual(['from-xdg']);
  });

  it('treats an empty XDG_STATE_HOME as unset and falls back to the home lock', () => {
    writeLock(path.join('user', '.agents', '.skill-lock.json'), { version: 3, skills: { 'from-home': githubEntry } });

    const entries = service({ XDG_STATE_HOME: '' }).load();

    expect([...entries.keys()]).toEqual(['from-home']);
  });

  it('ignores a pre-v3 lock entirely (upstream wipes and rebuilds it itself)', () => {
    writeLock(path.join('user', '.agents', '.skill-lock.json'), { version: 2, skills: { 'legacy': githubEntry } });

    expect([...service().load().keys()]).toEqual([]);
  });

  it('ignores an unknown future schema version instead of guessing at it', () => {
    writeLock(path.join('user', '.agents', '.skill-lock.json'), { version: 4, skills: { 'future': githubEntry } });

    expect([...service().load().keys()]).toEqual([]);
  });

  it('returns empty for a missing lock and for malformed JSON (broken evidence is no evidence)', () => {
    expect([...service().load().keys()]).toEqual([]);

    writeLock(path.join('user', '.agents', '.skill-lock.json'), '{not json');
    expect([...service().load().keys()]).toEqual([]);
  });
});

describe('lockEntryToSource (evidence mapping, ADR-0011 decisions 2-3)', () => {
  it('maps a github entry to a git source with subpath minus /SKILL.md and the folder hash as baseline', () => {
    expect(lockEntryToSource(githubEntry)).toEqual({
      type: 'git',
      url: 'https://github.com/intellectronica/agent-skills.git',
      subpath: 'skills/beautiful-mermaid',
      ref: null,
      baseline_hash: '88651e5cc10e4b028798dcfa45b1c1004e93f8b2',
    });
  });

  it('keeps an explicit ref (branch/tag) from the lock', () => {
    expect(lockEntryToSource({ ...githubEntry, ref: 'v2' })).toMatchObject({ ref: 'v2' });
  });

  it('maps a local entry with the path as its identity — update and doctor treat it like any sourced skill', () => {
    expect(lockEntryToSource({ ...githubEntry, sourceType: 'local', sourceUrl: '/some/local/path' })).toEqual({
      type: 'local',
      url: '/some/local/path',
      subpath: 'skills/beautiful-mermaid',
      ref: null,
      baseline_hash: '88651e5cc10e4b028798dcfa45b1c1004e93f8b2',
    });
  });

  it('degrades a local entry without a sourceUrl to an audited snapshot (no url, no update eligibility)', () => {
    const { sourceUrl: _sourceUrl, ...withoutUrl } = githubEntry;
    expect(lockEntryToSource({ ...withoutUrl, sourceType: 'local' })).toEqual({
      type: 'local',
      url: null,
      subpath: 'skills/beautiful-mermaid',
      ref: null,
      baseline_hash: '88651e5cc10e4b028798dcfa45b1c1004e93f8b2',
    });
  });

  it('maps a plain git entry like a github one', () => {
    expect(lockEntryToSource({ ...githubEntry, sourceType: 'git' })).toMatchObject({ type: 'git', url: githubEntry.sourceUrl });
  });

  it('returns null for source types skills-manager cannot update (recorded-but-unupdatable is worse than a snapshot)', () => {
    for (const sourceType of ['mintlify', 'huggingface', 'well-known', 'node_modules', 'something-new']) {
      expect(lockEntryToSource({ ...githubEntry, sourceType })).toBeNull();
    }
  });

  it('returns null for entries without a skillPath (no evidence where the skill lived upstream)', () => {
    const { skillPath: _skillPath, ...withoutPath } = githubEntry;
    expect(lockEntryToSource(withoutPath)).toBeNull();
  });

  it('returns null when skillPath does not point at a SKILL.md (unexpected shape, no guess)', () => {
    expect(lockEntryToSource({ ...githubEntry, skillPath: 'skills/beautiful-mermaid' })).toBeNull();
  });

  it('returns null for git entries without a sourceUrl (nothing to update from)', () => {
    const { sourceUrl: _sourceUrl, ...withoutUrl } = githubEntry;
    expect(lockEntryToSource(withoutUrl)).toBeNull();
  });

  it('tolerates a missing folder hash (baseline null, source still adoptable)', () => {
    const { skillFolderHash: _hash, ...withoutHash } = githubEntry;
    expect(lockEntryToSource(withoutHash)).toMatchObject({ baseline_hash: null });
  });

  it('returns null for a null/undefined entry', () => {
    expect(lockEntryToSource(undefined)).toBeNull();
    expect(lockEntryToSource(null)).toBeNull();
  });
});
