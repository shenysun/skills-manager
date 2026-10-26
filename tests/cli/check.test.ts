import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/** `check`: the hub CI gates behind one exit code (offline by default). */

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'check-cli-'));
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

function addSkill(name: string, body: string) {
  const dir = path.join(sourceRoot, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n${body}\n`);
}

describe('check', () => {
  it('passes a clean hub with the default offline gates', () => {
    addSkill('clean', '# clean');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['check']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/PASS security/);
    expect(result.stdout).toMatch(/PASS provenance/);
    expect(result.stdout).toMatch(/check: PASS \(2\/2 gates\)/);
  });

  it('fails on a high security finding and names the follow-up command', () => {
    addSkill('risky', 'bash -c "echo hi"');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['check']);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL security: \d+ high finding/);
    expect(result.stdout).toMatch(/audit security --strict/);
  });

  it('--budget adds a gate; --json reports every gate', () => {
    addSkill('clean', '# clean');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['check', '--budget', '0', '--json']);
    const out = JSON.parse(result.stdout);
    expect(out.gates.map((g: { gate: string }) => g.gate)).toEqual(['security', 'provenance', 'budget']);
    // Nothing distributed → 0 resident tokens → within a 0 budget.
    expect(out.ok).toBe(true);
    expect(result.status).toBe(0);
  });

  it('rejects a bad --budget', () => {
    expect(run(['check', '--budget', 'lots']).status).toBe(1);
  });

  it('--overlap and --descriptions are opt-in gates', () => {
    for (const name of ['grill-a', 'grill-b']) {
      const dir = path.join(sourceRoot, 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Relentless interview to sharpen a plan or design. Use when the user wants grilling.\n---\n# x\n`);
    }
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    expect(run(['check']).status).toBe(0);
    const result = run(['check', '--overlap', '--descriptions', '--json']);
    expect(result.status).toBe(1);
    const out = JSON.parse(result.stdout);
    expect(out.gates.map((g: { gate: string }) => g.gate)).toEqual(['security', 'provenance', 'overlap', 'descriptions']);
    expect(out.gates.find((g: { gate: string }) => g.gate === 'overlap').ok).toBe(false);
    expect(out.gates.find((g: { gate: string }) => g.gate === 'descriptions').ok).toBe(true);
  });

  it('--descriptions fails on an error-level lint finding', () => {
    const dir = path.join(sourceRoot, 'skills', 'claude-helper');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), '---\nname: claude-helper\ndescription: Formats release notes from merged pull requests. Use when cutting a release.\n---\n# x\n');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const result = run(['check', '--descriptions']);
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAIL descriptions: 1 error/);
    expect(result.stdout).toMatch(/audit descriptions/);
  });
});
