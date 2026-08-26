import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let root: string;
let home: string;
let userHome: string;
let project: string;
let sourceRoot: string;

const bin = path.resolve(process.cwd(), 'src/cli.ts');

function setupSkillFixtures() {
  for (const name of ['alpha', 'beta']) {
    mkdirSync(path.join(sourceRoot, 'skills', name), { recursive: true });
    writeFileSync(path.join(sourceRoot, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n# ${name}\n`);
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cli-status-'));
  home = path.join(root, 'home');
  userHome = path.join(root, 'user');
  project = path.join(root, 'project');
  sourceRoot = path.join(root, 'source');
  setupSkillFixtures();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function cli(args: string[]) {
  return execSync(`tsx ${bin} --home ${home} ${args.join(' ')}`, {
    env: { ...process.env, SKILL_HOME: home, SKILLS_MANAGER_USER_HOME: userHome },
    encoding: 'utf8',
  });
}

describe('status / update reminder', () => {
  it('status prints stale count when copy targets lag the hub', () => {
    cli(['add', sourceRoot, '--skill', 'alpha', '--yes']);
    cli(['distribute', '--to', 'project', '--project', project, '--skill', 'alpha', '--agent', 'zed', '--mode', 'copy']);
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
    const out = cli(['status']);
    expect(out).toMatch(/stale: 1|outdated: 1/);
  });

  it('update prints a trailing reminder when stale targets remain', () => {
    // Install both alpha and beta so we have a registry source for each.
    cli(['add', sourceRoot, '--skill', 'alpha', '--yes']);
    cli(['add', sourceRoot, '--skill', 'beta', '--yes']);
    // Distribute both as copy targets.
    cli(['distribute', '--to', 'project', '--project', project, '--skill', 'alpha', '--agent', 'zed', '--mode', 'copy']);
    cli(['distribute', '--to', 'project', '--project', project, '--skill', 'beta', '--agent', 'zed', '--mode', 'copy']);
    // Make both stale.
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
    writeFileSync(path.join(home, 'skills', 'beta', 'SKILL.md'), `---\nname: beta\n---\n# v2\n`);
    // Update only beta: cascade refreshes beta, leaving alpha stale.
    const out = cli(['update', '--skill', 'beta']);
    // Reminder must surface on the success path.
    expect(out).toMatch(/stale|copy 目标|落后|--refresh/);
  });

  it('redistribute --refresh is an alias for --outdated', () => {
    cli(['add', sourceRoot, '--skill', 'alpha', '--yes']);
    cli(['distribute', '--to', 'project', '--project', project, '--skill', 'alpha', '--agent', 'zed', '--mode', 'copy']);
    writeFileSync(path.join(home, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\n---\n# v2\n`);
    const out = cli(['redistribute', '--refresh', '--to', 'project', '--project', project]);
    expect(readFileSync(path.join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf8')).toMatch(/v2/);
    expect(out).toMatch(/refresh|refreshed|已刷新|同步/);
  });
});
