import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/** Shared base for the sync test suite (ticket 01's reusable footing): a temp
 *  root, a hub to operate on, an isolated user home, and a local bare repo
 *  standing in for a network remote — zero network, CI-safe (spec Testing
 *  Decisions). Later sync tickets (push/pull/status) reuse these helpers. */
export function makeSyncRoot(prefix: string) {
  const root = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
  return { root, home: path.join(root, 'hub'), userHome: path.join(root, 'user-home') };
}

/** A minimal valid hub: registry.yaml + one canonical skill. */
export function makeHub(home: string, skills: string[] = ['demo']) {
  mkdirSync(path.join(home, 'skills'), { recursive: true });
  writeFileSync(path.join(home, 'registry.yaml'), 'skills: {}\n');
  for (const skill of skills) addSkill(home, skill);
  return home;
}

export function addSkill(home: string, name: string) {
  mkdirSync(path.join(home, 'skills', name), { recursive: true });
  writeFileSync(path.join(home, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: fixture\n---\n# ${name}\n`);
}

/** Git identity for commits made inside the CLI under an isolated HOME (no
 *  global gitconfig exists there). */
export const GIT_IDENTITY: Record<string, string> = {
  GIT_AUTHOR_NAME: 'Sync Test',
  GIT_AUTHOR_EMAIL: 'sync-test@example.com',
  GIT_COMMITTER_NAME: 'Sync Test',
  GIT_COMMITTER_EMAIL: 'sync-test@example.com',
};

/** A local bare repository to use as the sync remote URL. `-b main` keeps the
 *  remote's HEAD symref aligned with the branch `sync init` pins on every hub
 *  (a dangling remote HEAD would make second-machine pulls unresolvable). */
export function makeBareRemote(root: string, name = 'remote.git'): string {
  const url = path.join(root, name);
  const result = spawnSync('git', ['init', '--bare', '-b', 'main', url]);
  if (result.status !== 0) throw new Error(`git init --bare failed: ${result.stderr}`);
  return url;
}

/** Run git in a directory; throws on failure so test setup cannot silently pass. */
export function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...GIT_IDENTITY } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
