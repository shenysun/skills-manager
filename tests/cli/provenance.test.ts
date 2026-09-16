import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'provenance-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  addRegistrySkill('legacy', { imported: true });
  addRegistrySkill('lockless', { imported: true }); // imported, but the lock has no entry for it
  addRegistrySkill('snapshot', { imported: true }); // lock evidence degrades to an audited snapshot (local, no url)
  addRegistrySkill('authored'); // locally authored: no url, never imported
  addRegistrySkill('archived-import', { imported: true, archived: true });
  writeLock({
    version: 3,
    skills: {
      legacy: { sourceType: 'github', sourceUrl: 'https://github.com/owner/repo.git', skillPath: 'skills/legacy/SKILL.md', skillFolderHash: 'tree-sha-legacy' },
      snapshot: { sourceType: 'local', skillPath: 'skills/snapshot/SKILL.md', skillFolderHash: 'tree-sha-snapshot' },
    },
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function addRegistrySkill(name: string, entry: { imported?: boolean; archived?: boolean } = {}) {
  mkdirSync(path.join(home, 'skills', name), { recursive: true });
  writeFileSync(path.join(home, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: fixture\n---\n# ${name}\n`);
  const registryFile = path.join(home, 'registry.yaml');
  let yaml = `  ${name}:\n`;
  yaml += `    path: skills/${name}\n    title: ${name}\n    category: experimental\n    tags: []\n    consumers: []\n`;
  yaml += `    source: {type: local, url: null, subpath: null, ref: null, upstream_commit: null, baseline_hash: null}\n`;
  yaml += `    update_policy: manual\n    description: fixture\n`;
  if (entry.imported) yaml += `    imported: true\n    imported_at: '2026-08-01T00:00:00.000Z'\n`;
  if (entry.archived) yaml += `    archived: true\n`;
  // Append below the `skills:` header so each fixture call adds one entry.
  const previous = existsSync(registryFile) ? readFileSync(registryFile, 'utf8').replace(/^skills:\n/, '') : '';
  writeFileSync(registryFile, `skills:\n${yaml}${previous}`);
}

function writeLock(lock: unknown) {
  // The CLI resolves the lock through SKILLS_MANAGER_USER_HOME (XDG_STATE_HOME only
  // applies when the runtime is constructed with an explicit env, which the CLI does not).
  mkdirSync(path.join(userHome, '.agents'), { recursive: true });
  writeFileSync(path.join(userHome, '.agents', '.skill-lock.json'), JSON.stringify(lock));
}

describe('provenance list', () => {
  it('splits pending skills into imported-without-source and locally authored', () => {
    const result = run(['provenance', 'list', '--json']);
    expect(result.status).toBe(0);
    const pending = JSON.parse(result.stdout);
    expect(pending.importedWithoutSource.map((item: { skill: string }) => item.skill)).toEqual(['legacy', 'lockless', 'snapshot']);
    expect(pending.locallyAuthored).toEqual(['authored']);
  });

  it('prints a human-readable listing without --json', () => {
    const result = run(['provenance', 'list']);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Imported without source \(3\)/);
    expect(result.stdout).toMatch(/legacy/);
    expect(result.stdout).toMatch(/Locally authored, no upstream recorded \(1\)/);
    expect(result.stdout).toMatch(/authored/);
  });

  it('excludes archived skills from both buckets', () => {
    const result = run(['provenance', 'list', '--json']);
    const pending = JSON.parse(result.stdout);
    expect(JSON.stringify(pending)).not.toContain('archived-import');
  });
});

describe('provenance adopt', () => {
  it('adopts lockfile evidence onto legacy imported skills and clears the doctor queue for them', () => {
    const before = run(['doctor']);
    expect(JSON.parse(before.stdout).importedWithoutSource.map((item: { skill: string }) => item.skill)).toContain('legacy');

    const result = run(['provenance', 'adopt']);
    expect(result.status).toBe(0);
    const adopted = JSON.parse(result.stdout).adopted;
    expect(adopted).toEqual([
      expect.objectContaining({ skill: 'legacy', source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/legacy', ref: null, baseline_hash: 'tree-sha-legacy' } }),
      expect.objectContaining({ skill: 'snapshot', source: expect.objectContaining({ type: 'local', url: null, subpath: 'skills/snapshot', baseline_hash: 'tree-sha-snapshot' }) }),
    ]);

    const after = run(['doctor']);
    const remaining = JSON.parse(after.stdout).importedWithoutSource.map((item: { skill: string }) => item.skill);
    // snapshot keeps an audited-snapshot source (local, url null); doctor's legacy
    // queue ignores nothing on archived (existing behaviour, unchanged here).
    expect(remaining).toEqual(['archived-import', 'lockless', 'snapshot']);
  });

  it('persists adopted evidence to the registry', () => {
    run(['provenance', 'adopt']);
    const listed = run(['list']);
    const legacy = JSON.parse(listed.stdout).find((skill: { name: string }) => skill.name === 'legacy');
    expect(legacy.source).toMatchObject({ type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/legacy', baseline_hash: 'tree-sha-legacy' });
  });

  it('skips imported skills with no lock entry and leaves them untouched', () => {
    const result = run(['provenance', 'adopt']);
    expect(JSON.parse(result.stdout).skipped).toEqual([{ skill: 'lockless', reason: 'no_evidence' }]);
    const listed = run(['list']);
    const lockless = JSON.parse(listed.stdout).find((skill: { name: string }) => skill.name === 'lockless');
    expect(lockless.source.url).toBeNull();
  });

  it('--dry-run reports adoptions without touching the registry', () => {
    const result = run(['provenance', 'adopt', '--dry-run']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).dryRun).toBe(true);
    expect(JSON.parse(result.stdout).adopted.map((item: { skill: string }) => item.skill)).toEqual(['legacy', 'snapshot']);

    const pending = JSON.parse(run(['provenance', 'list', '--json']).stdout);
    expect(pending.importedWithoutSource.map((item: { skill: string }) => item.skill)).toEqual(['legacy', 'lockless', 'snapshot']);
  });

  it('--skill limits adoption and flags non-pending names', () => {
    const result = run(['provenance', 'adopt', '--skill', 'legacy', '--skill', 'authored']);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout);
    expect(output.adopted.map((item: { skill: string }) => item.skill)).toEqual(['legacy']);
    expect(output.skipped).toEqual([{ skill: 'authored', reason: 'not_pending' }]);
    expect(JSON.parse(run(['provenance', 'list', '--json']).stdout).importedWithoutSource.map((item: { skill: string }) => item.skill)).toEqual(['lockless', 'snapshot']);
  });
});

describe('provenance adopt: frontmatter evidence channel (ADR-0017, provenance-get ticket 05)', () => {
  /** gh skill's writer output: provenance travels in the file, no lockfile involved. */
  const ghMetadata = (repoUrl: string) =>
    `---\nname: PLACEHOLDER\ntitle: fixture\ndescription: fixture\nmetadata:\n    github-repo: ${repoUrl}\n    github-ref: refs/tags/v1.0.0\n    github-tree-sha: tree456\n    github-path: skills/lockless\n---\n# fixture\n`;

  function giveFrontmatterEvidence(skill: string, repoUrl: string) {
    writeFileSync(path.join(home, 'skills', skill, 'SKILL.md'), ghMetadata(repoUrl).replace('PLACEHOLDER', skill));
  }

  it('adopts frontmatter-only evidence — a gh skill install with no lockfile entry at all (US9)', () => {
    giveFrontmatterEvidence('lockless', 'https://github.com/monalisa/octocat-skills');
    const result = run(['provenance', 'adopt']);
    expect(result.status).toBe(0);

    const adopted = JSON.parse(result.stdout).adopted;
    expect(adopted.map((item: { skill: string }) => item.skill)).toEqual(['legacy', 'lockless', 'snapshot']);
    // The frontmatter-only skill adopts exactly the file's own evidence:
    // tree-sha lands as the upstream_tree anchor, host github.com as type github.
    expect(adopted.find((item: { skill: string }) => item.skill === 'lockless').source).toEqual({
      type: 'github',
      url: 'https://github.com/monalisa/octocat-skills',
      subpath: 'skills/lockless',
      ref: 'refs/tags/v1.0.0',
      upstream_tree: 'tree456',
    });
    expect(JSON.parse(result.stdout).skipped).toEqual([]);

    // The adopted evidence survives the safe-patch whitelist (type included) and lands in the registry.
    const listed = JSON.parse(run(['list']).stdout);
    const lockless = listed.find((skill: { name: string }) => skill.name === 'lockless');
    expect(lockless.source).toMatchObject({ type: 'github', url: 'https://github.com/monalisa/octocat-skills', upstream_tree: 'tree456' });
    // The mirror write point rides the same registry write (ticket 02): the file
    // grows our identity keys beside the gh-written evidence.
    const skillMd = readFileSync(path.join(home, 'skills', 'lockless', 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli');
    expect(skillMd).toContain('github-repo: https://github.com/monalisa/octocat-skills');
  });

  it('prefers the file own evidence when both channels exist and conflict (US10)', () => {
    giveFrontmatterEvidence('legacy', 'https://github.com/monalisa/octocat-skills');
    const result = run(['provenance', 'adopt']);
    expect(result.status).toBe(0);

    const legacy = JSON.parse(result.stdout).adopted.find((item: { skill: string }) => item.skill === 'legacy');
    expect(legacy.source).toMatchObject({
      type: 'github',
      url: 'https://github.com/monalisa/octocat-skills', // the lockfile said owner/repo.git — the file wins
      subpath: 'skills/lockless',
      upstream_tree: 'tree456',
    });
    expect(legacy.source.baseline_hash).toBeUndefined();
  });

  it('still adopts pure lockfile evidence for files carrying none', () => {
    const result = run(['provenance', 'adopt']);
    const legacy = JSON.parse(result.stdout).adopted.find((item: { skill: string }) => item.skill === 'legacy');
    expect(legacy.source).toMatchObject({ type: 'git', url: 'https://github.com/owner/repo.git', baseline_hash: 'tree-sha-legacy' });
  });

  it('maps a *.ghe.com repo to the generic git kind (ADR-0017 host ruling)', () => {
    giveFrontmatterEvidence('lockless', 'https://acme.ghe.com/monalisa/octocat-skills');
    const result = run(['provenance', 'adopt']);
    const lockless = JSON.parse(result.stdout).adopted.find((item: { skill: string }) => item.skill === 'lockless');
    expect(lockless.source).toMatchObject({ type: 'git', url: 'https://acme.ghe.com/monalisa/octocat-skills' });
  });
});
