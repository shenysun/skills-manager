import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/** `audit descriptions`: report-only lint; `--strict` fails on errors only. */

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'audit-desc-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (args: string[]) => runCli(home, userHome, args);

function skill(name: string, description: string) {
  const dir = path.join(sourceRoot, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nbody\n`);
}

const GOOD = 'Generate commit messages by analyzing git diffs. Use when the user asks for help writing commit messages.';

describe('audit descriptions', () => {
  it('prints a text report, exits 0 by default', () => {
    skill('commit-msg', GOOD);
    skill('docs-helper', 'Helps with documents');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const r = run(['audit', 'descriptions']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('docs-helper');
    expect(r.stdout).toContain('no-trigger');
    expect(r.stdout).not.toMatch(/\d+\s+commit-msg/);
  });

  it('--strict ignores warnings but fails on errors; --json is parseable', () => {
    skill('docs-helper', 'Helps with documents');
    skill('claude-tool', GOOD);
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    expect(run(['audit', 'descriptions', 'docs-helper', '--strict']).status).toBe(0);
    const r = run(['audit', 'descriptions', '--strict', '--json']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('FAIL (--strict)');
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.errors).toBe(1);
    expect(report.skills[0]).toMatchObject({ skill: 'claude-tool' });
  });

  it('rejects unknown skills', () => {
    skill('commit-msg', GOOD);
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const r = run(['audit', 'descriptions', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Skill not found: nope');
  });
});
