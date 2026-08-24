import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = path.resolve(import.meta.dirname, '..', '..', 'dist', 'cli.js');

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'distribute-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
  const source = path.join(root, 'source');
  mkdirSync(path.join(source, 'skills', 'alpha'), { recursive: true });
  writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), `---\nname: alpha\ntitle: Alpha\ndescription: cli\n---\n# Alpha\n`);
  run(['add', source, '--skill', 'alpha', '--yes']);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function baseEnv() {
  return { ...process.env, HOME: userHome, SKILLS_MANAGER_USER_HOME: userHome, CLAUDECODE: undefined, CLAUDE_CODE: undefined, CURSOR_AGENT: undefined, CODEX_SANDBOX: undefined, CODEX_CI: undefined, CODEX_THREAD_ID: undefined, GEMINI_CLI: undefined, ANTIGRAVITY_AGENT: undefined, REPL_ID: undefined, XDG_CONFIG_HOME: undefined };
}

function run(args: string[]) {
  return spawnSync(process.execPath, [cli, '--home', home, ...args], { encoding: 'utf8', env: baseEnv() });
}

describe('distribute CLI surface', () => {
  it('accepts repeatable --agent flags', () => {
    const result = run(['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed', '--agent', 'warp']);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(userHome, '.agents', 'skills', 'alpha'))).toBe(true);
    const summary = JSON.parse(result.stdout);
    expect(summary.agents.sort()).toEqual(['warp', 'zed']);
    expect(summary.entries).toHaveLength(1);
  });

  it('defaults to the detected set when --agent is omitted', () => {
    mkdirSync(path.join(userHome, '.claude'), { recursive: true });
    const result = run(['distribute', '--to', 'user', '--skill', 'alpha']);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(userHome, '.claude', 'skills', 'alpha'))).toBe(true);
    // The detected set is machine-dependent (e.g. /Applications probes); assert
    // membership, not the exact list.
    expect(JSON.parse(result.stdout).agents).toContain('claude-code');
  });

  it('rejects --consumer as an unknown option', () => {
    const result = run(['distribute', '--to', 'user', '--skill', 'alpha', '--consumer', 'agents']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown/i);
  });

  it('rejects expose, hide, and rebuild-views as unknown commands', () => {
    for (const command of ['expose', 'hide', 'rebuild-views']) {
      const result = run([command, 'agents', 'alpha']);
      expect(result.status, command).not.toBe(0);
      expect(result.stderr, command).toMatch(/unknown/i);
    }
  });

  it('undistribute accepts --agent and reference-counts', () => {
    run(['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed', '--agent', 'warp']);
    const result = run(['undistribute', '--to', 'user', '--skill', 'alpha', '--agent', 'warp']);
    expect(result.status).toBe(0);
    expect(existsSync(path.join(userHome, '.agents', 'skills', 'alpha'))).toBe(true);
    run(['undistribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed']);
    expect(existsSync(path.join(userHome, '.agents', 'skills', 'alpha'))).toBe(false);
  });

  it('exposes migrate-consumers and catalog commands', () => {
    const migration = run(['migrate-consumers', '--dry-run']);
    expect(migration.status).toBe(0);
    expect(JSON.parse(migration.stdout).agentMapping.claude).toEqual(['claude-code']);
    const info = run(['catalog', 'info']);
    expect(info.status).toBe(0);
  });
});
