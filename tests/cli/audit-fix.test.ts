import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

let root: string;
let home: string;
let userHome: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'audit-fix-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  sourceRoot = path.join(root, 'source');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const run = (args: string[]) => runCli(home, userHome, args);
function addSkill(name: string, description: string) {
  const dir = path.join(sourceRoot, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\nlicense: MIT\n---\n# ${name}\n`);
}
const hubMd = (name: string) => readFileSync(path.join(home, 'skills', name, 'SKILL.md'), 'utf8');

describe('audit descriptions --fix / --write', () => {
  beforeEach(() => {
    addSkill('pdf-forms', 'Fills PDF forms and extracts fields from scanned invoices.');
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
  });

  it('--fix prints a diff and writes nothing', () => {
    const before = hubMd('pdf-forms');
    const result = run(['audit', 'descriptions', '--fix']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/1 rewrite\(s\) proposed \(dry run; add --write to apply\)/);
    expect(result.stdout).toMatch(/^- Fills PDF forms/m);
    expect(result.stdout).toMatch(/^\+ Fills PDF forms .* Use when the user mentions/m);
    expect(hubMd('pdf-forms')).toBe(before);
  });

  it('--fix --write updates SKILL.md and the registry, then the lint is clean', () => {
    const result = run(['audit', 'descriptions', '--fix', '--write', '--json']);
    expect(JSON.parse(result.stdout).written).toBe(true);
    expect(hubMd('pdf-forms')).toMatch(/description: .*Use when the user mentions.*\nlicense: MIT\n/);
    const lint = JSON.parse(run(['audit', 'descriptions', '--json']).stdout);
    expect(lint.warnings).toBe(0);
  });

  it('--write without --fix is refused', () => {
    const result = run(['audit', 'descriptions', '--write']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--write needs --fix/);
  });
});

describe('audit overlap --fix', () => {
  it('proposes boundary lines and writes both sides only with --write', () => {
    addSkill('grill-me', 'A relentless interview to sharpen a plan or design.');
    addSkill('grill-with-docs', "A relentless interview to sharpen a plan or design, which also creates docs and a glossary.");
    expect(run(['add', sourceRoot, '--all', '--yes']).status).toBe(0);
    const dry = run(['audit', 'overlap', '--fix']);
    expect(dry.stdout).toMatch(/use the grill-with-docs skill instead/);
    expect(hubMd('grill-me')).not.toMatch(/instead/);
    run(['audit', 'overlap', '--fix', '--write']);
    expect(hubMd('grill-me')).toMatch(/use the grill-with-docs skill instead/);
    expect(hubMd('grill-with-docs')).toMatch(/use the grill-me skill instead/);
  });
});
