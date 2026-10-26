import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/**
 * `audit security [--strict]`: default report-only JSON; `--strict` exits 1
 * only when a high-severity finding is present (warn/info never fail).
 */

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'audit-security-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function writeSourceSkill(name: string, body: string) {
  const dir = path.join(sourceRoot, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), body);
}

describe('audit security', () => {
  it('prints JSON and exits 0 by default even with high findings', () => {
    writeSourceSkill(
      'risky',
      '---\nname: risky\ndescription: d\n---\nbash -c "echo hi"\n',
    );
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'risky']);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim().slice(result.stdout.trim().indexOf('{')));
    expect(report.skill).toBe('risky');
    expect(report.findings.some((f: { severity: string }) => f.severity === 'high')).toBe(true);
  });

  it('--strict exits 1 on high findings, still prints the report', () => {
    writeSourceSkill(
      'risky',
      '---\nname: risky\ndescription: d\n---\nbash -c "echo hi"\n',
    );
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'risky', '--strict']);
    expect(result.status, result.stderr).toBe(1);
    const report = JSON.parse(result.stdout.trim().slice(result.stdout.trim().indexOf('{')));
    expect(report.skill).toBe('risky');
    expect(report.summary.total).toBeGreaterThan(0);
  });

  it('--strict exits 0 when only warn findings are present', () => {
    writeSourceSkill(
      'noisy',
      '---\nname: noisy\ndescription: d\n---\ncurl https://example.com\n',
    );
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'noisy', '--strict']);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout.trim().slice(result.stdout.trim().indexOf('{')));
    expect(report.summary.network).toBeGreaterThanOrEqual(1);
    expect(report.findings.every((f: { severity: string }) => f.severity !== 'high')).toBe(true);
  });

  it('--strict exits 0 for a clean skill', () => {
    writeSourceSkill(
      'safe',
      '---\nname: safe\ndescription: summarize files\n---\n# Safe\nRead and summarize.\n',
    );
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'safe', '--strict']);
    expect(result.status, result.stderr).toBe(0);
  });

  it('--format github prints Actions annotations instead of JSON', () => {
    writeSourceSkill(
      'risky',
      '---\nname: risky\ndescription: d\n---\nbash -c "echo hi"\n',
    );
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'risky', '--format', 'github']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^::error file=skills\/risky\/SKILL\.md,line=\d+,title=bash_c::/);
    expect(result.stdout).not.toMatch(/\{\s*"skill"/);
  });

  it('--format github with --strict still exits 1 on high findings', () => {
    writeSourceSkill(
      'risky',
      '---\nname: risky\ndescription: d\n---\nbash -c "echo hi"\n',
    );
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'risky', '--strict', '--format', 'github']);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stdout).toMatch(/::error /);
  });

  it('--format rejects unknown values', () => {
    writeSourceSkill('safe', '---\nname: safe\ndescription: d\n---\n# safe\n');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['audit', 'security', 'safe', '--format', 'sarif']);
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/json or github/);
  });

});
