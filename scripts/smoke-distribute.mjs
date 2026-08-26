import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreServices } from '../dist/core/index.js';
import { NodeFileSystem, ShellRunner } from '../dist/infra/index.js';
import { SkillsManagerError } from '../dist/shared/errors.js';

class SmokeGit {
  clone() { throw new Error('clone should not be called for local sources'); }
  checkout() { throw new Error('checkout should not be called for local sources'); }
  revParseHead() { return 'local-head'; }
  listRemoteHeads() { return ['main']; }
  statusShort() { return ''; }
  log() { return [{ hash: 'local-head', timestamp: new Date(0).toISOString(), subject: 'smoke' }]; }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'skills-distribute-smoke-'));

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

try {
  const home = path.join(tempRoot, 'home');
  const userHome = path.join(tempRoot, 'user');
  const project = path.join(tempRoot, 'project');
  const sourceRoot = path.join(tempRoot, 'source');
  mkdirSync(path.join(sourceRoot, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(sourceRoot, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: Distribute smoke\n---\n# Alpha\n`);

  const services = servicesFor(home, userHome);
  services.skillHome.ensure();
  assert.equal(existsSync(path.join(home, 'views')), false);
  services.install.installFromSourceSelection({ source: sourceRoot, selectors: ['alpha'], overwrite: true });
  assert.equal(existsSync(path.join(home, 'views')), false);
  assert.equal(services.doctor.check().distribution.managedEntries, 0);

  services.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed'] });
  const userLink = path.join(userHome, '.agents', 'skills', 'alpha');
  assert.equal(lstatSync(userLink).isSymbolicLink(), true);
  assert.equal(path.resolve(readlinkSync(userLink)), path.resolve(home, 'skills', 'alpha'));
  assert.equal(services.doctor.check().distribution.managedEntries, 1);

  const projectApply = services.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'] });
  const copied = path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md');
  assert.equal(existsSync(copied), true);
  assert.equal(lstatSync(path.join(project, '.agents', 'skills', 'alpha')).isSymbolicLink(), false);
  assert.equal(existsSync(path.join(project, '.skills-manager')), false);
  assert.equal(projectApply.mode, 'copy');

  const foreign = path.join(userHome, '.claude', 'skills', 'alpha');
  mkdirSync(foreign, { recursive: true });
  writeFileSync(path.join(foreign, 'SKILL.md'), '# foreign\n');
  assert.throws(() => services.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'] }), (error) => error instanceof SkillsManagerError && error.code === 'distribute_foreign_exists');
  services.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['claude-code'], force: true });
  assert.equal(lstatSync(foreign).isSymbolicLink(), true);

  writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: changed\n---\n# Changed\n`);
  assert.equal(services.doctor.check().distribution.outdated > 0, true);
  services.distribute.redistributeOutdated({ to: 'project', projectRoot: project });
  assert.match(readFileSync(copied, 'utf8'), /Changed/);

  services.distribute.apply({ to: 'project', projectRoot: project, skills: ['alpha'], agents: ['zed'] });
  assert.throws(() => services.distribute.rollback('project', project), (error) => error instanceof SkillsManagerError && error.code === 'distribute_project_rollback_unsupported');
  assert.equal(existsSync(path.join(project, '.agents', 'skills', 'alpha')), true);

  services.distribute.apply({ to: 'user', skills: ['alpha'], agents: ['zed', 'warp'] });
  services.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['warp'] });
  assert.equal(existsSync(userLink), true);
  services.distribute.undistribute({ to: 'user', skills: ['alpha'], agents: ['zed'] });
  assert.equal(existsSync(userLink), false);
  assert.equal(existsSync(path.join(home, 'skills', 'alpha', 'SKILL.md')), true);

  mkdirSync(path.join(home, 'views', 'agents'), { recursive: true });
  try { symlinkSync(path.join(home, 'skills', 'alpha'), path.join(home, 'views', 'agents', 'alpha')); } catch { /* ignore */ }
  const migrated = services.distribute.migrateViews();
  assert.equal(migrated.distributed.includes('agents:alpha') || existsSync(path.join(userHome, '.agents', 'skills', 'alpha')), true);
  assert.match(services.doctor.check().warnings.join('\n'), /Leftover hub views/);

  assert.throws(() => services.adopt.adopt('agents', 'alpha'), (error) => error instanceof SkillsManagerError && error.code === 'adopt_removed');

  console.log('distribute smoke test passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
