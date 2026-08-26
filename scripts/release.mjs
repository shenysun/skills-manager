#!/usr/bin/env node
import { execSync } from 'node:child_process';

/** Date-versioned release: today becomes YYYY.M.D (npm semver rejects leading zeros,
 *  so 2026-08-26 → 2026.8.26; a same-day rerun gets -2, -3, …).
 *  From a clean, synced main: writes the version into package.json, commits,
 *  tags vX.Y.Z, and pushes — the pushed tag triggers the publish workflow. */

const run = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const fail = (message) => {
  console.error(`release: ${message}`);
  process.exit(1);
};

run('git fetch origin main --tags --quiet');
if (run('git status --porcelain')) fail('working tree is not clean — commit or stash first');
if (run('git rev-parse --abbrev-ref HEAD') !== 'main') fail('run from the main branch');
if (run('git rev-parse HEAD') !== run('git rev-parse origin/main')) fail('main is not in sync with origin/main — pull or push first');

const now = new Date();
const base = `${now.getFullYear()}.${now.getMonth() + 1}.${now.getDate()}`;
const sameDay = run('git tag -l').split('\n').filter((t) => t === `v${base}` || t.startsWith(`v${base}-`));
let version = base;
if (sameDay.length > 0) {
  const highest = Math.max(...sameDay.map((t) => Number(t.slice(`v${base}-`.length)) || 0));
  version = `${base}-${highest + 1}`;
}

execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { stdio: 'inherit' });
execSync('git add package.json');
if (run('git diff --cached --name-only')) {
  execSync(`git commit -m "chore(release): v${version}"`, { stdio: 'inherit' });
}
execSync(`git tag v${version}`);
execSync(`git push origin main v${version}`, { stdio: 'inherit' });
console.log(`released v${version}: tag pushed, npm publish now runs in GitHub Actions`);
