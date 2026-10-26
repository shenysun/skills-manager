import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCoreServices } from '../../src/core/services/index.js';
import { BUILTIN_SCANNER_ID } from '../../src/core/services/security-scan.js';
import { createNodeFileSystem } from '../../src/infra/index.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

/**
 * Doctor's security rollup: always present (like residentCost); warnings only
 * when high-severity findings exist, pointing at `audit security --strict`
 * and the copy-paste Action example.
 */

const fakeGit = { statusShort: () => '', clone: () => ({ repoDir: '', commit: null }), pull: () => null, latestCommit: () => null } as never;
const fakeRunner = { run: () => ({ stdout: '', stderr: '' }) } as never;

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'doctor-security-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  sourceRoot = path.join(root, 'source');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSourceSkill(name: string, body: string) {
  const dir = path.join(sourceRoot, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), body);
}

function services(skills: string[]) {
  const s = createCoreServices({
    skillHomeRoot: home,
    projectRoot: root,
    fs: createNodeFileSystem(),
    git: fakeGit,
    processRunner: fakeRunner,
    userHome,
    env: {},
    catalogSnapshot: fixtureSnapshot(),
  });
  s.skillHome.ensure();
  if (skills.length > 0) {
    s.install.installFromSourceSelection({ source: sourceRoot, selectors: skills, overwrite: true });
  }
  return s;
}

describe('doctor security field', () => {
  it('is always present on an empty hub (high=0)', () => {
    const report = services([]).doctor.check();
    expect(report.security).toEqual({
      scanner: BUILTIN_SCANNER_ID,
      scanned: 0,
      high: 0,
      skillsWithHigh: [],
    });
  });

  it('matches SecurityScanService.hubSummary for the same skill set', () => {
    writeSourceSkill('safe', '---\nname: safe\ndescription: d\n---\n# safe\n');
    const s = services(['safe']);
    const names = s.registry.listSkills().map((skill) => skill.name);
    expect(s.doctor.check().security).toEqual(s.security.hubSummary(names));
  });
});

describe('doctor warnings mention security only for high findings', () => {
  it('emits no security warning when only warn findings exist', () => {
    writeSourceSkill(
      'noisy',
      '---\nname: noisy\ndescription: d\n---\ncurl https://example.com\n',
    );
    const warnings = services(['noisy']).doctor.check().warnings.join('\n');
    expect(warnings).not.toMatch(/security/i);
    expect(warnings).not.toMatch(/audit security/i);
  });

  it('warns once with --strict pointer when high findings are present', () => {
    writeSourceSkill(
      'risky',
      '---\nname: risky\ndescription: d\n---\nbash -c "echo hi"\n',
    );
    writeSourceSkill('safe', '---\nname: safe\ndescription: d\n---\n# safe\n');
    const { warnings, security } = services(['risky', 'safe']).doctor.check();
    const securityWarnings = warnings.filter((line) => /security/i.test(line));
    expect(securityWarnings).toHaveLength(1);
    expect(securityWarnings[0]).toMatch(/audit security --strict/);
    expect(securityWarnings[0]).toMatch(/examples\/github-actions\/audit-security\.yml/);
    expect(security.high).toBeGreaterThan(0);
    expect(security.skillsWithHigh).toEqual(['risky']);
    expect(security.scanned).toBe(2);
  });
});
