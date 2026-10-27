import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/** `trigger test`: offline rank of hub skills vs a sample request; `--expect` is a CI gate. */

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'trigger-test-cli-'));
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
  skill('release-notes', 'Draft release notes from merged pull requests.');
  expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
}

describe('trigger test', () => {
  it('ranks pdf-forms first for a PDF request', () => {
    seed();
    const r = run(['trigger', 'test', 'fill PDF form fields from a scanned document']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('Trigger test (idf-jaccard)');
    expect(r.stdout).toMatch(/#1\s+0\.\d{3}\s+pdf-forms/);
  });

  it('--expect passes when the skill is #1 and fails otherwise', () => {
    seed();
    const ok = run(['trigger', 'test', 'fill PDF form fields', '--expect', 'pdf-forms']);
    expect(ok.status, ok.stderr).toBe(0);
    expect(ok.stdout).toContain('PASS');
    const bad = run(['trigger', 'test', 'fill PDF form fields', '--expect', 'release-notes']);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('FAIL');
    expect(bad.stdout).toContain('FAIL');
  });

  it('--top widens the --expect window and truncates the listing', () => {
    seed();
    const r = run(['trigger', 'test', 'write unit tests with Jest fixtures and mocks', '--top', '2', '--expect', 'testing-conventions']);
    // either jest-unit-tests or testing-conventions may win; both must fit in top 2
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('(top 2)');
    expect(r.stdout).not.toMatch(/#3\s/);
    const miss = run(['trigger', 'test', 'write unit tests with Jest', '--top', '1', '--expect', 'pdf-forms']);
    expect(miss.status).toBe(1);
  });

  it('--json carries ranks; unknown --expect and bad --top are refused', () => {
    seed();
    const r = run(['trigger', 'test', 'draft release notes for merged pull requests', '--expect', 'release-notes', '--json']);
    expect(r.status, r.stderr).toBe(0);
    const body = JSON.parse(r.stdout.slice(r.stdout.indexOf('{')));
    expect(body.method).toBe('idf-jaccard');
    expect(body.hits[0].skill).toBe('release-notes');
    expect(body.expect).toMatchObject({ skill: 'release-notes', ok: true, rank: 1 });
    expect(run(['trigger', 'test', 'anything', '--expect', 'nope']).stderr).toContain('Skill not found: nope');
    expect(run(['trigger', 'test', 'anything', '--top', '0']).stderr).toContain('--top expects');
  });
});
