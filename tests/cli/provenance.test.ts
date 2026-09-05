import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = path.resolve(import.meta.dirname, '..', '..', 'dist', 'cli.js');

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

function baseEnv() {
  return { ...process.env, HOME: userHome, SKILLS_MANAGER_USER_HOME: userHome, CLAUDECODE: undefined, CLAUDE_CODE: undefined, CURSOR_AGENT: undefined, CODEX_SANDBOX: undefined, CODEX_CI: undefined, CODEX_THREAD_ID: undefined, GEMINI_CLI: undefined, ANTIGRAVITY_AGENT: undefined, REPL_ID: undefined, XDG_CONFIG_HOME: undefined };
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, '--home', home, ...args], { encoding: 'utf8', env: baseEnv() });
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
    expect(JSON.parse(result.stdout).skipped).toEqual([{ skill: 'lockless', reason: 'no_lock_evidence' }]);
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
