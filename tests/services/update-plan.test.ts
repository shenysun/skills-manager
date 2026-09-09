import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'update-plan-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function services() {
  const s = createCoreServices({
    skillHomeRoot: path.join(root, 'home'),
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: { statusShort: () => '', clone: () => {}, revParseHead: () => 'a', revParseTree: () => 'b', listRemoteHeads: () => [], log: () => [] } as never,
    processRunner: { run: () => ({ status: 0, stdout: '', stderr: '' }) } as never,
    tempRoot: path.join(root, 'tmp'),
    userHome: path.join(root, 'user'),
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  return s;
}

describe('update plan output shape (manager-skill-first ticket 04)', () => {
  it('is grouped only — no duplicated flat candidate list beside the groups', () => {
    const s = services();
    for (const name of ['alpha', 'beta']) {
      const dir = path.join(root, 'home', 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
    }
    s.registry.ensureEntries([
      { skill: 'alpha', patch: { source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/alpha' } } },
      { skill: 'beta', patch: { source: { type: 'git', url: 'https://github.com/owner/repo.git', subpath: 'skills/beta' } } },
    ]);

    const plan = s.update.plan();

    expect('candidates' in plan).toBe(false);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].skills.map((skill) => skill.skill).sort()).toEqual(['alpha', 'beta']);
  });
});
