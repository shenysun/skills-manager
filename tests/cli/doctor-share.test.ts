import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/**
 * CLI surface for `doctor --share`: privacy-safe paste card — counts and
 * magnitudes only (no skillHome, no broken-link paths, no skill names).
 */

let root: string;
let home: string;
let userHome: string;
let project: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'doctor-share-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  for (const [name, description] of Object.entries({ alpha: 'aaaa', beta: 'bbbbbbbb' })) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(
      path.join(sourceRoot, 'skills', name, 'SKILL.md'),
      '---\nname: ' + name + '\ntitle: ' + name + '\ndescription: ' + description + '\n---\n# ' + name + '\n',
    );
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

describe('doctor --share', () => {
  it('prints a privacy-safe paste card without absolute paths or skill names', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha', '-s', 'beta']);
    run(['distribute', '--to', 'project', '--project', project, '-a', 'eve', '-s', 'alpha']);
    mkdirSync(path.join(userHome, '.agents', 'skills', 'stranger'), { recursive: true });

    const result = run(['doctor', '--share']);
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout;
    expect(out).toContain('Hub health · skills-manager');
    expect(out).toMatch(/\d+ skill\(s\) · managed \d+ · outdated \d+ · foreign \d+/);
    expect(out).toMatch(/Resident: ≈\d+ tokens \/ message · char-approx/);
    expect(out).toMatch(/Security: \d+ high · builtin-v1 · scanned \d+/);
    expect(out).toMatch(/Warnings:/);
    expect(out).toContain('Try: npx skills-manager-cli');
    expect(out).toContain('Reproduce: skills-manager doctor --share');
    expect(out).toContain('https://github.com/shenysun/skills-manager');
    // Privacy: no hub / home / project paths, and no per-skill names from the ledger.
    expect(out).not.toContain(home);
    expect(out).not.toContain(userHome);
    expect(out).not.toContain(project);
    expect(out).not.toContain('alpha');
    expect(out).not.toContain('beta');
    expect(out).not.toContain('stranger');
  });

  it('rejects combining --share with --migrate-views', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    expect(run(['doctor', '--share', '--migrate-views']).status).toBe(1);
  });

  it('default doctor still prints JSON with skillHome', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    const report = JSON.parse(run(['doctor']).stdout);
    expect(report.skillHome).toBe(home);
    expect(typeof report.skillCount).toBe('number');
  });
});
