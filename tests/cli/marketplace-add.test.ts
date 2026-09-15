import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/**
 * CLI surface for marketplace sources (source-formats ticket 06): a repo URL
 * whose root carries `.claude-plugin/marketplace.json` enters the plugin
 * discovery flow with no flag — `--list` presents the two-level plugin →
 * skills structure, `--skill` selects within a plugin, and installed skills
 * are full hub citizens.
 */

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'marketplace-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function commitAll(cwd: string) {
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'init', '--initial-branch=main'], { cwd });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'add', '.'], { cwd });
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'], { cwd });
}

function marketplaceRepo(): string {
  const repo = path.join(root, 'mp-repo');
  mkdirSync(path.join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(repo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-mp',
      plugins: [
        { name: 'core', source: './plugins/core', skills: ['./skills/alpha', './skills/beta'] },
        { name: 'linked', source: { source: 'git-subdir', repo: 'other/repo', path: 'skills' } },
      ],
    }),
  );
  for (const skill of ['alpha', 'beta']) {
    const dir = path.join(repo, 'plugins', 'core', 'skills', skill);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${skill}\ntitle: ${skill} title\ndescription: ${skill} desc\n---\n# ${skill}\n`);
  }
  commitAll(repo);
  return repo;
}

describe('add with a marketplace repo URL', () => {
  it('presents the two-level plugin → skills structure in --list without any flag', () => {
    const repo = marketplaceRepo();
    const result = runCli(home, userHome, ['add', `file://${repo}`, '--list']);
    expect(result.status, result.stderr).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.plugins).toContainEqual({
      name: 'core',
      skills: [
        { name: 'alpha', subpath: 'plugins/core/skills/alpha' },
        { name: 'beta', subpath: 'plugins/core/skills/beta' },
      ],
    });
    expect(payload.plugins).toContainEqual({ name: 'linked', skills: [], unsupported: 'git-subdir' });
    expect(payload.discovered.map((skill: { name: string }) => skill.name).sort()).toEqual(['alpha', 'beta']);
  });

  it('installs a whole plugin via --skill <plugin>, recording marketplace provenance', () => {
    const repo = marketplaceRepo();
    const install = runCli(home, userHome, ['add', `file://${repo}`, '--skill', 'core', '--yes']);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout).installed.sort()).toEqual(['alpha', 'beta']);

    const entry = JSON.parse(runCli(home, userHome, ['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(entry.source.type).toBe('marketplace');
    expect(entry.source.subpath).toBe('plugins/core/skills/alpha');
  });

  it('fails explicitly when naming an externally-sourced plugin instead of silently skipping', () => {
    const repo = marketplaceRepo();
    const result = runCli(home, userHome, ['add', `file://${repo}`, '--skill', 'linked']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not supported yet/);
  });

  it('leaves an installed marketplace skill a full hub citizen (distribute / categories / archive)', () => {
    const repo = marketplaceRepo();
    runCli(home, userHome, ['add', `file://${repo}`, '--skill', 'alpha', '--yes']);
    const brief = JSON.parse(runCli(home, userHome, ['list', '--brief']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(brief.updatable).toBe(true);
    const tagged = runCli(home, userHome, ['categories', 'set', 'alpha', 'testing']);
    expect(tagged.status, tagged.stderr).toBe(0);
    const distributed = runCli(home, userHome, ['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'claude-code']);
    expect(distributed.status, distributed.stderr).toBe(0);
    expect(JSON.parse(distributed.stdout).entries.length).toBeGreaterThan(0);
    const undistributed = runCli(home, userHome, ['undistribute', '--to', 'user', '--skill', 'alpha']);
    expect(undistributed.status, undistributed.stderr).toBe(0);
    const archived = runCli(home, userHome, ['archive', 'alpha']);
    expect(archived.status, archived.stderr).toBe(0);
    expect(JSON.parse(runCli(home, userHome, ['list']).stdout)).toHaveLength(0);
  });
});
