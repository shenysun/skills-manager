import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { closeWireServers, serveMutableWire, serveWire } from '../fixtures/wire-http.js';

/**
 * CLI surface for single-SKILL.md URL sources (source-formats ticket 03): the
 * one-step `add <url> --all` install over the real download transport (a local
 * wire server), the plain-http confirmation gate, registry provenance, and
 * update-standing — url installs are not update candidates until URL freshness
 * detection lands (ticket 05), the same standing as archives.
 */

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'url-source-cli-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  return closeWireServers();
});

function run(args: string[], extraEnv: Record<string, string> = {}) {
  return runCli(home, userHome, args, extraEnv);
}

describe('add with a single-SKILL.md URL', () => {
  it('installs with --all --yes over plain http, recording url provenance with no git anchors', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha', 'from a url') });
    const install = run(['add', `${baseUrl}/SKILL.md`, '--all', '--yes']);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout).installed).toEqual(['alpha']);

    const entry = JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(entry.source.type).toBe('url');
    expect(entry.source.url).toBe(`${baseUrl}/SKILL.md`);
    expect(entry.source.upstream_commit).toBeNull();
    expect(entry.source.upstream_tree).toBeNull();
  });

  it('lists the discovered skill with --list', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha') });
    const result = run(['add', `${baseUrl}/SKILL.md`, '--list', '--yes']);
    expect(result.status, result.stderr).toBe(0);
    const discovered = JSON.parse(result.stdout).discovered;
    expect(discovered.map((skill: { name: string }) => skill.name)).toEqual(['alpha']);
  });

  it('refuses a plain-http download without --yes in a non-interactive session', () => {
    // example.com needs no server: the gate refuses before any byte moves.
    const result = run(['add', 'http://example.com/SKILL.md', '--all']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/unencrypted http/);
    expect(result.stderr).toMatch(/--yes/);
  });

  it('shows the url skill as updatable in list --brief (ticket 05: url joins the update flow)', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha') });
    run(['add', `${baseUrl}/SKILL.md`, '--all', '--yes']);
    const row = JSON.parse(run(['list', '--brief']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(row.updatable).toBe(true);
  });

  it('update --plan lists the url skill alongside a local-source candidate', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha') });
    run(['add', `${baseUrl}/SKILL.md`, '--all', '--yes']);
    const localSource = path.join(root, 'local-repo');
    mkdirSync(path.join(localSource, 'skills', 'gamma'), { recursive: true });
    writeFileSync(path.join(localSource, 'skills', 'gamma', 'SKILL.md'), skillMarkdown('gamma'));
    run(['add', localSource, '--skill', 'gamma']);

    const plan = JSON.parse(run(['update', '--plan']).stdout);
    const candidates = plan.groups.flatMap((group: { skills: Array<{ skill: string }> }) => group.skills.map((skill) => skill.skill));
    expect(candidates).toContain('gamma');
    expect(candidates).toContain('alpha');
  });

  it('surfaces the download size limit through SKILLS_MANAGER_DOWNLOAD_MAX_BYTES', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha') });
    const result = run(['add', `${baseUrl}/SKILL.md`, '--all', '--yes'], { SKILLS_MANAGER_DOWNLOAD_MAX_BYTES: '16' });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/exceeds the maximum/);
  });

  it('update --check judges a url source: upToDate until the payload changes, then stale (US-23/24)', async () => {
    const server = await serveMutableWire(skillMarkdown('alpha', 'from the wire'));
    run(['add', server.url, '--all', '--yes']);

    const fresh = JSON.parse(run(['update', '--check']).stdout);
    expect(fresh.upToDate).toContain('alpha');

    await server.set(skillMarkdown('alpha', 'from the wire, renewed'));
    const stale = JSON.parse(run(['update', '--check']).stdout);
    expect(stale.stale.map((item: { skill: string }) => item.skill)).toContain('alpha');
  });
});
