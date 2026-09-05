import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cli = path.resolve(import.meta.dirname, '..', '..', 'dist', 'cli.js');

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'edit-source-cli-'));
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

describe('edit full git source', () => {
  it('writes a complete git source from --source-git owner/repo --subpath', () => {
    const result = run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills']);
    expect(result.status).toBe(0);
    const source = JSON.parse(result.stdout).source;
    expect(source).toMatchObject({ type: 'git', url: 'https://github.com/vercel-labs/skills.git', subpath: 'skills/find-skills' });
    expect(source.ref).toBeNull();
    expect(source.upstream_commit).toBeNull();
  });

  it('field shape matches an add-installed source (same key set)', () => {
    const result = run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills']);
    expect(result.status).toBe(0);
    const edited = JSON.parse(result.stdout).source;
    // add writes exactly type/url/subpath/ref/upstream_commit (baseline_hash is init-adoption-only, ADR-0011);
    // edit must land in the same shape so update treats both identically.
    expect(Object.keys(edited).sort()).toEqual(['ref', 'subpath', 'type', 'upstream_commit', 'url']);
  });

  it('records --source-ref alongside --source-git', () => {
    const result = run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills', '--source-ref', 'v1.2.3']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).source).toMatchObject({ type: 'git', url: 'https://github.com/vercel-labs/skills.git', subpath: 'skills/find-skills', ref: 'v1.2.3' });
  });

  it('normalizes a full GitHub URL to the canonical repo URL', () => {
    const result = run(['edit', 'alpha', '--source-git', 'https://github.com/vercel-labs/skills', '--subpath', 'skills/find-skills']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).source.url).toBe('https://github.com/vercel-labs/skills.git');
  });

  it('makes the skill an update candidate (url + subpath)', () => {
    run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills']);
    const plan = run(['update', '--plan']);
    expect(plan.status).toBe(0);
    const candidates = JSON.parse(plan.stdout).candidates;
    expect(candidates).toEqual(expect.arrayContaining([expect.objectContaining({ skill: 'alpha', url: 'https://github.com/vercel-labs/skills.git', subpath: 'skills/find-skills' })]));
  });

  it('persists the source to registry.yaml (not just stdout)', () => {
    run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--subpath', 'skills/find-skills']);
    const listed = run(['list', '--include-archived']);
    expect(listed.status).toBe(0);
    const alpha = JSON.parse(listed.stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(alpha.source).toMatchObject({ type: 'git', url: 'https://github.com/vercel-labs/skills.git', subpath: 'skills/find-skills' });
  });

  it('rejects --source-git together with --source-url', () => {
    const result = run(['edit', 'alpha', '--source-git', 'vercel-labs/skills', '--source-url', 'https://example.com/repo.git']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--source-git|--source-url/);
  });

  it('keeps legacy --source-url behaviour unchanged', () => {
    const result = run(['edit', 'alpha', '--source-url', 'https://example.com/repo.git']);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).source).toMatchObject({ type: 'git', url: 'https://example.com/repo.git' });
  });
});
