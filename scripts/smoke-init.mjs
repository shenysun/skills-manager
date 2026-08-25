import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreServices } from '../dist/core/index.js';
import { NodeFileSystem, ShellRunner } from '../dist/infra/index.js';

class SmokeGit {
  clone() { throw new Error('clone should not be called'); }
  checkout() { throw new Error('checkout should not be called'); }
  revParseHead() { return 'local-head'; }
  listRemoteHeads() { return ['main']; }
  statusShort() { return ''; }
  log() { return [{ hash: 'local-head', timestamp: new Date(0).toISOString(), subject: 'smoke' }]; }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'skills-init-smoke-'));

function servicesFor(home, userHome) {
  return createCoreServices({
    skillHomeRoot: home,
    projectRoot: repoRoot,
    fs: new NodeFileSystem(),
    git: new SmokeGit(),
    processRunner: new ShellRunner(),
    tempRoot,
    userHome,
    env: {},
  });
}

function makeRuntimeSkill(userHome, agentRelativeDir, name, body) {
  const dir = path.join(userHome, agentRelativeDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), body);
  return dir;
}

try {
  const home = path.join(tempRoot, 'home');
  const userHome = path.join(tempRoot, 'user');
  const alphaDir = makeRuntimeSkill(userHome, '.claude/skills', 'alpha', `---\nname: alpha\ntitle: Alpha\ndescription: init smoke\n---\n# Alpha\n`);
  makeRuntimeSkill(userHome, '.cursor/skills', 'beta', `---\nname: beta\ntitle: Beta\ndescription: init smoke\n---\n# Beta\n`);
  makeRuntimeSkill(userHome, '.claude/skills', 'clash', `---\nname: clash\ntitle: claude copy\n---\n# clash\n`);
  makeRuntimeSkill(userHome, '.cursor/skills', 'clash', `---\nname: clash\ntitle: cursor copy\n---\n# clash\n`);

  const services = servicesFor(home, userHome);

  // Dry-run: full plan, zero side effects.
  const plan = services.init.run({ dryRun: true });
  assert.equal(plan.dryRun, true);
  assert.deepEqual(plan.discovered.map((skill) => skill.name).sort(), ['alpha', 'beta', 'clash']);
  assert.equal(lstatSync(alphaDir).isSymbolicLink(), false);
  assert.equal(existsSync(path.join(home, 'skills')), false);

  // Real run: unambiguous imports land; the clash is reported, not guessed.
  const result = services.init.run();
  assert.deepEqual(result.imported.sort(), ['alpha', 'beta']);
  assert.deepEqual(result.conflicts.map((conflict) => conflict.skill), ['clash']);
  for (const [dir, name] of [[alphaDir, 'alpha'], [path.join(userHome, '.cursor', 'skills', 'beta'), 'beta']]) {
    assert.equal(lstatSync(dir).isSymbolicLink(), true);
    assert.equal(path.resolve(readlinkSync(dir)), path.resolve(home, 'skills', name));
  }
  assert.equal(existsSync(path.join(home, 'skills', 'alpha', 'SKILL.md')), true);
  assert.equal(services.registry.getEntry('alpha').imported, true);
  assert.equal(services.doctor.check().distribution.managedEntries, 2);
  assert.equal(services.backups.list().length, 2);

  // Idempotent re-run.
  const again = services.init.run();
  assert.deepEqual(again.imported, []);
  assert.deepEqual(again.skippedManaged.sort(), ['alpha', 'beta']);
  assert.deepEqual(again.conflicts.map((conflict) => conflict.skill), ['clash']);

  // Resolve the clash: the cursor copy wins, both origins back-symlink.
  const resolved = services.init.run({ resolve: { clash: 'cursor' } });
  assert.deepEqual(resolved.imported, ['clash']);
  assert.match(readFileSync(path.join(home, 'skills', 'clash', 'SKILL.md'), 'utf8'), /cursor copy/);
  for (const origin of [path.join(userHome, '.claude', 'skills', 'clash'), path.join(userHome, '.cursor', 'skills', 'clash')]) {
    assert.equal(lstatSync(origin).isSymbolicLink(), true);
  }

  // Doctor surfaces imported skills without a managed source; edit supplies one.
  assert.deepEqual(services.doctor.check().importedWithoutSource.map((item) => item.skill).sort(), ['alpha', 'beta', 'clash']);
  services.registry.editSafeFields('alpha', { source: { type: 'git', url: 'https://github.com/example/alpha' } });
  assert.deepEqual(services.doctor.check().importedWithoutSource.map((item) => item.skill).sort(), ['beta', 'clash']);

  // Self-service rollback: restore rolls one skill fully back.
  const restore = services.backups.restore('alpha');
  assert.equal(restore.restored, true);
  assert.equal(lstatSync(alphaDir).isSymbolicLink(), false);
  assert.match(readFileSync(path.join(alphaDir, 'SKILL.md'), 'utf8'), /init smoke/);
  assert.equal(existsSync(path.join(home, 'skills', 'alpha')), false);
  assert.equal(services.registry.getEntry('alpha'), undefined);

  console.log('init smoke test passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
