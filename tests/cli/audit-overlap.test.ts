import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/** `audit overlap`: offline description-collision report; `--strict` makes it a CI gate. */

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'audit-overlap-cli-'));
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

function seed() {
  skill('jest-unit-tests', 'Write unit tests with Jest for React components. Use when adding or fixing tests.');
  skill('testing-conventions', 'Testing conventions - how to write unit tests with Jest, fixtures and mocks. Use when adding tests.');
  skill('pdf-forms', 'Fill and extract PDF form fields.');
  expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
}

describe('audit overlap', () => {
  it('reports the competing pair in text and exits 0 by default', () => {
    seed();
    const r = run(['audit', 'overlap']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('jest-unit-tests ↔ testing-conventions');
    expect(r.stdout).toContain('shared:');
    expect(r.stdout).not.toContain('pdf-forms ↔');
  });

  it('--json carries pairs; --strict exits 1 with a stderr verdict', () => {
    seed();
    const r = run(['audit', 'overlap', '--json', '--strict']);
    expect(r.status).toBe(1);
    const report = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(report.method).toBe('idf-jaccard');
    expect(report.scanned).toBe(3);
    expect(report.pairs[0]).toMatchObject({ a: 'jest-unit-tests', b: 'testing-conventions' });
    expect(r.stderr).toContain('FAIL (--strict)');
  });

  it('limits to named skills, and --strict passes when nothing overlaps', () => {
    seed();
    const r = run(['audit', 'overlap', 'pdf-forms', 'jest-unit-tests', '--strict']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('0 pair(s) across 2 skill(s)');
  });

  it('rejects a bad --threshold and unknown skills', () => {
    seed();
    expect(run(['audit', 'overlap', '--threshold', '1.5']).stderr).toContain('--threshold expects');
    const r = run(['audit', 'overlap', 'nope']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Skill not found: nope');
  });
});
