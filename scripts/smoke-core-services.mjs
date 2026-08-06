import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreServices } from '../dist/core/index.js';
import { NodeFileSystem, ShellRunner } from '../dist/infra/index.js';

class SmokeGit {
  clone() { throw new Error('clone should not be called for local sources'); }
  checkout() { throw new Error('checkout should not be called for local sources'); }
  revParseHead() { return 'local-head'; }
  listRemoteHeads() { return ['main']; }
  statusShort() { return ''; }
  log() { return [{ hash: 'local-head', timestamp: new Date(0).toISOString(), subject: 'smoke' }]; }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'skills-core-smoke-'));
try {
  const home = path.join(tempRoot, 'home');
  const sourceRoot = path.join(tempRoot, 'source');
  const alphaDir = path.join(sourceRoot, 'skills', 'alpha');
  mkdirSync(alphaDir, { recursive: true });
  writeFileSync(path.join(alphaDir, 'SKILL.md'), `---\nname: alpha\ntitle: Alpha Skill\ndescription: Smoke-test skill\n---\n# Alpha\n`);

  const services = createCoreServices({
    skillHomeRoot: home,
    projectRoot: repoRoot,
    fs: new NodeFileSystem(),
    git: new SmokeGit(),
    processRunner: new ShellRunner(),
    tempRoot,
  });

  services.skillHome.ensure();
  const checkout = services.source.checkout(sourceRoot);
  const discovered = services.source.discover(checkout);
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].name, 'alpha');

  const installed = services.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], consumers: ['agents'], overwrite: true });
  assert.deepEqual(installed.installed, ['alpha']);
  assert.equal(services.registry.skillExists('alpha'), true);
  assert.equal(services.registry.getEntry('alpha')?.source?.subpath, 'skills/alpha');

  const updatePlan = services.update.plan();
  assert.equal(updatePlan.candidates.length, 1);
  assert.equal(updatePlan.groups.length, 1);

  const doctor = services.doctor.check();
  assert.equal(doctor.skillCount, 1);
  assert.equal(doctor.viewLinks.agents, 1);

  const record = services.activity.record({ action: 'smoke', summary: 'Core services smoke test' });
  assert.equal(services.activity.list({ limit: 1 })[0].id, record.id);

  const packageCheck = services.package.check();
  assert.equal(packageCheck.packageJsonPath.endsWith('package.json'), true);

  const invalidSource = path.join(tempRoot, 'invalid-source');
  mkdirSync(path.join(invalidSource, 'bad'), { recursive: true });
  writeFileSync(path.join(invalidSource, 'bad', 'SKILL.md'), `---\nname: ../bad\n---\n# Bad\n`);
  assert.throws(() => services.source.discover(services.source.checkout(invalidSource)), /Skill name/);

  const duplicateSource = path.join(tempRoot, 'duplicate-source');
  mkdirSync(path.join(duplicateSource, 'one'), { recursive: true });
  mkdirSync(path.join(duplicateSource, 'two'), { recursive: true });
  writeFileSync(path.join(duplicateSource, 'one', 'SKILL.md'), `---\nname: duplicate\n---\n# One\n`);
  writeFileSync(path.join(duplicateSource, 'two', 'SKILL.md'), `---\nname: duplicate\n---\n# Two\n`);
  const duplicateSkills = services.source.discover(services.source.checkout(duplicateSource));
  assert.throws(() => services.source.assertUniqueSkillDestinations(duplicateSkills), /duplicate destination names/);

  console.log('core services smoke test passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
