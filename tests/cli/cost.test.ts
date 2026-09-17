import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/**
 * CLI surface for the cost ledger (spec context-cost): `cost` renders the
 * account in English — path groups → per-skill lines → total + unmanaged line
 * → three suggestion layers, every number `≈`-prefixed and abbreviated
 * (`≈1.2k`), every suggestion a verbatim runnable `undistribute` command.
 * `--json` carries the full three-layer structure with `method`; `--top`
 * bounds the expensive-description list. No filter flags in v1 — filtering is
 * `--json`'s job.
 */

let root: string;
let home: string;
let userHome: string;
let project: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cost-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  const descriptions: Record<string, string> = {
    alpha: 'aaaa', // 1 description token
    beta: 'bbbbbbbb', // 2
    gamma: '提交代码变更到 git 仓库', // 10
    // kilo: 4796 chars -> 1199 description tokens + 1 name token = 1200 -> ≈1.2k
    kilo: 'k'.repeat(4796),
    yankee: 'yyyyyyyy', // 2
    zulu: 'zzzz', // 1
  };
  for (const [name, description] of Object.entries(descriptions)) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ntitle: ${name}\ndescription: ${description}\n---\n# ${name}\n`);
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function json(result: { stdout: string }) {
  return JSON.parse(result.stdout.trim().slice(result.stdout.trim().indexOf('{')));
}

describe('cost (human output)', () => {
  it('groups by runtime path with per-skill lines, a total, and the unmanaged count line', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha', '-s', 'beta']);
    run(['distribute', '--to', 'project', '--project', project, '-a', 'eve', '-s', 'gamma']);
    mkdirSync(path.join(userHome, '.agents', 'skills', 'stranger'), { recursive: true });
    const result = run(['cost']);
    expect(result.status, result.stderr).toBe(0);
    const out = result.stdout;
    // Path groups with their agent family, per-skill lines beneath.
    expect(out).toContain(path.join(userHome, '.agents', 'skills'));
    expect(out).toContain(path.join(project, 'agent', 'skills'));
    expect(out).toMatch(/alpha\s+≈2/);
    expect(out).toMatch(/beta\s+≈3/);
    expect(out).toMatch(/gamma\s+≈11/);
    // Total and the honest omission line.
    expect(out).toMatch(/≈16 tokens?/); // 2 + 3 + 11
    expect(out).toContain('1 unmanaged skill(s) not counted');
  });

  it('abbreviates every token number ≈-prefixed (≈1.2k style)', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'kilo']);
    const out = run(['cost']).stdout;
    expect(out).toContain('≈1.2k');
    expect(out).not.toMatch(/(?<!≈)\b1200\b/);
  });

  it('renders suggestions with verbatim undistribute commands — including --to and --project', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha']);
    run(['distribute', '--to', 'project', '--project', project, '-a', 'eve', '-s', 'gamma']);
    const out = run(['cost']).stdout;
    expect(out).toContain('skills-manager undistribute --to user --agent zed --skill alpha');
    expect(out).toContain(`skills-manager undistribute --to project --project ${project} --agent eve --skill gamma`);
    expect(out).toMatch(/report-only/i);
  });

  it('heads archived-but-distributed recalls with the (archived) annotation', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'beta', '--mode', 'copy']);
    run(['archive', 'beta']);
    const out = run(['cost']).stdout;
    expect(out).toMatch(/beta \(archived\)/);
    expect(out).toContain('skills-manager undistribute --to user --agent zed --skill beta');
  });

  it('flags scattered distributions with per-path recall commands', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha']);
    run(['distribute', '--to', 'user', '-a', 'claude-code', '-s', 'alpha']);
    const out = run(['cost']).stdout;
    expect(out).toContain(`alpha on 2 paths: ${path.join(userHome, '.agents', 'skills')}, ${path.join(userHome, '.claude', 'skills')}`);
    expect(out).toContain('skills-manager undistribute --to user --agent zed --skill alpha');
    expect(out).toContain('skills-manager undistribute --to user --agent claude-code --skill alpha');
  });
});

describe('cost --json', () => {
  it('carries the full three-layer structure with method: char-approx', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha', '-s', 'beta']);
    run(['distribute', '--to', 'project', '--project', project, '-a', 'eve', '-s', 'gamma']);
    const ledger = json(run(['cost', '--json']));
    expect(ledger.method).toBe('char-approx');
    expect(ledger.totalTokens).toBe(16);
    expect(ledger.paths).toHaveLength(2);
    expect(ledger.paths.flatMap((group: { skills: Array<{ skill: string }> }) => group.skills.map((line) => line.skill)).sort()).toEqual(['alpha', 'beta', 'gamma']);
    expect(Object.keys(ledger.suggestions).sort()).toEqual(['archived', 'scattered', 'topDescriptions']);
    expect(ledger.suggestions.topDescriptions.map((item: { skill: string }) => item.skill)).toEqual(['gamma', 'beta', 'alpha']);
    expect(ledger.errors).toEqual([]);
  });

  it('lists error entries for unreadable SKILL.md instead of silently zeroing', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'beta', '--mode', 'copy']);
    rmSync(path.join(userHome, '.agents', 'skills', 'beta', 'SKILL.md'));
    const ledger = json(run(['cost', '--json']));
    expect(ledger.errors).toEqual([{ skill: 'beta', runtimePath: path.join(userHome, '.agents', 'skills', 'beta'), reason: 'SKILL.md unreadable' }]);
    expect(ledger.totalTokens).toBe(0);
  });
});

describe('cost --top', () => {
  it('defaults to 5 and narrows with an explicit value', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha', '-s', 'beta', '-s', 'gamma', '-s', 'kilo', '-s', 'yankee', '-s', 'zulu']);
    const defaultOut = run(['cost']).stdout;
    expect(defaultOut).toMatch(/Top 5 most expensive descriptions/);
    const narrowed = json(run(['cost', '--json', '--top', '2']));
    expect(narrowed.suggestions.topDescriptions.map((item: { skill: string }) => item.skill)).toEqual(['kilo', 'gamma']);
    expect(run(['cost', '--top', '1']).stdout).toMatch(/Top 1 most expensive description/);
  });

  it('rejects a non-numeric --top', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha']);
    expect(run(['cost', '--top', 'many']).status).toBe(1);
  });
});

describe('v1 has no filter flags (filtering is --json\'s job)', () => {
  it('rejects --path and --skill as unknown options', () => {
    run(['add', sourceRoot, '--all', '--yes']);
    run(['distribute', '--to', 'user', '-a', 'zed', '-s', 'alpha']);
    expect(run(['cost', '--path', userHome]).status).toBe(1);
    expect(run(['cost', '--skill', 'alpha']).status).toBe(1);
  });
});
