import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { skillMarkdown, writeZip } from '../fixtures/archives.js';
import { closeWireServers, serveMutableWire, serveWire } from '../fixtures/wire-http.js';

/**
 * CLI seam of the frontmatter mirror for non-git sources (provenance-get
 * ticket 03, ADR-0017): wellknown installs mirror the index URL + declared
 * digest, url installs mirror the download URL + content sha — both under
 * `skills-manager-*` keys only, never fake `github-*` keys (US12); archive /
 * local installs grow no mirror at all (US13); and a url skill's mirror
 * refreshes along with the content at update while `update --check` keeps
 * judging it correctly (the hub tree legitimately differs from upstream by
 * the mirror bytes — the persisted content-sha anchor is the comparison side).
 */

const V2_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

const sha256 = (data: string | Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

const wellknownIndex = (entries: unknown[]) => JSON.stringify({ $schema: V2_SCHEMA, skills: entries });

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mirror-non-git-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  return closeWireServers();
});

function run(args: string[]) {
  return runCli(home, userHome, args);
}

function installedSkillMd(skill = 'alpha'): string {
  return readFileSync(path.join(home, 'skills', skill, 'SKILL.md'), 'utf8');
}

function registrySource(skill = 'alpha') {
  return JSON.parse(run(['list']).stdout).find((item: { name: string }) => item.name === skill).source;
}

describe('wellknown source mirror', () => {
  async function serveWellknown(body: string) {
    const base = await serveWire({
      kind: 'routes',
      routes: {
        '/.well-known/agent-skills/index.json': wellknownIndex([
          { name: 'alpha', description: 'an indexed skill', type: 'skill-md', url: 'files/alpha.md', digest: sha256(body) },
        ]),
        '/.well-known/agent-skills/files/alpha.md': body,
      },
    });
    return `${base}/.well-known/agent-skills/index.json`;
  }

  it('mirrors the index URL + declared digest under skills-manager-* keys (US12)', async () => {
    const indexUrl = await serveWellknown(skillMarkdown('alpha', 'an indexed skill'));
    const install = run(['add', indexUrl, '--all', '--yes']);
    expect(install.status, install.stderr).toBe(0);

    const source = registrySource();
    const skillMd = installedSkillMd();
    expect(skillMd).toContain(`skills-manager-source-url: ${indexUrl}\n`);
    expect(skillMd).toContain(`skills-manager-digest: ${source.upstream_digest}\n`);
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');
    expect(skillMd).not.toMatch(/github-/);
  });
});

describe('url source mirror', () => {
  it('mirrors the download URL + content sha under skills-manager-* keys, 1:1 with the registry (US12)', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha', 'from a url') });
    const install = run(['add', `${baseUrl}/SKILL.md`, '--all', '--yes']);
    expect(install.status, install.stderr).toBe(0);

    const source = registrySource();
    expect(source.upstream_content_sha).toMatch(/^sha256:[0-9a-f]{64}$/);
    const skillMd = installedSkillMd();
    expect(skillMd).toContain(`skills-manager-source-url: ${baseUrl}/SKILL.md\n`);
    expect(skillMd).toContain(`skills-manager-content-sha: ${source.upstream_content_sha}\n`);
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');
    expect(skillMd).not.toMatch(/github-/);
  });

  it('refreshes the mirrored content sha along with the content at update (US2 semantics)', async () => {
    const server = await serveMutableWire(skillMarkdown('alpha', 'from the wire'));
    run(['add', server.url, '--all', '--yes']);
    const before = installedSkillMd();
    const previousSha = registrySource().upstream_content_sha;
    expect(previousSha).toMatch(/^sha256:[0-9a-f]{64}$/);

    await server.set(skillMarkdown('alpha', 'from the wire, renewed'));
    const update = run(['update', '--skill', 'alpha']);
    expect(update.status, update.stderr).toBe(0);

    const newSha = registrySource().upstream_content_sha;
    const after = installedSkillMd();
    expect(after).toContain('from the wire, renewed');
    expect(after).toContain(`skills-manager-content-sha: ${newSha}\n`);
    expect(newSha).not.toBe(previousSha);
    expect(after).not.toContain(previousSha);
    expect(before).not.toBe(after);
  });

  it('a legacy url row anchors before its first mirror projection — a write point heals it into the anchored flow, never a false stale', async () => {
    const server = await serveMutableWire(skillMarkdown('alpha', 'from the wire'));
    // Pre-ADR-0017 row: hub skill + registry.yaml laid down by hand — no
    // mirror, no upstream_content_sha (going through the CLI would anchor it).
    const dir = path.join(home, 'skills', 'alpha');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'SKILL.md'), skillMarkdown('alpha', 'from the wire'));
    writeFileSync(path.join(home, 'registry.yaml'), [
      'skills:',
      '  alpha:',
      '    path: skills/alpha',
      '    title: alpha',
      '    category: experimental',
      '    tags: []',
      '    consumers: []',
      `    source: {type: url, url: '${server.url}', subpath: skills/alpha, ref: null, upstream_commit: null, upstream_tree: null}`,
      '    update_policy: manual',
      '    description: from the wire',
      '',
    ].join('\n'));

    // Any registry write point projects the mirror — the anchor must be
    // captured from the still-unmirrored tree first, or the fingerprint
    // fallback would report stale forever (spec US17: honest propagation).
    const edit = run(['edit', 'alpha', '--title', 'Renamed']);
    expect(edit.status, edit.stderr).toBe(0);
    const source = registrySource();
    expect(source.upstream_content_sha).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(installedSkillMd()).toContain(`skills-manager-content-sha: ${source.upstream_content_sha}\n`);

    // Unchanged upstream content ⇒ upToDate, the false-stale dead end is gone.
    const check = JSON.parse(run(['update', '--check']).stdout);
    expect(check.upToDate).toContain('alpha');
  });

  it('keeps update --check honest once the mirror exists: fresh stays upToDate, changed goes stale', async () => {
    const server = await serveMutableWire(skillMarkdown('alpha', 'from the wire'));
    run(['add', server.url, '--all', '--yes']);
    // The mirror bytes now separate the hub tree from the upstream tree —
    // the persisted content-sha anchor, not the hub fingerprint, must decide.
    expect(installedSkillMd()).toContain('skills-manager-content-sha:');

    const fresh = JSON.parse(run(['update', '--check']).stdout);
    expect(fresh.upToDate).toContain('alpha');

    await server.set(skillMarkdown('alpha', 'from the wire, renewed'));
    const stale = JSON.parse(run(['update', '--check']).stdout);
    expect(stale.stale.map((item: { skill: string }) => item.skill)).toContain('alpha');
  });
});

describe('mirror-less kinds stay mirror-free (US13)', () => {
  it('a local zip archive install grows no metadata mirror', () => {
    const zipPath = writeZip(root, 'bundle.zip', [{ name: 'skills/alpha/SKILL.md', data: skillMarkdown('alpha') }]);
    const install = run(['add', zipPath, '--skill', 'skills/alpha']);
    expect(install.status, install.stderr).toBe(0);
    expect(registrySource().type).toBe('archive');
    expect(installedSkillMd()).not.toContain('metadata:');
    expect(installedSkillMd()).not.toMatch(/skills-manager-written-by|github-/);
  });

  it('a local directory install grows no metadata mirror, and a registry write does not mis-write one', () => {
    const local = path.join(root, 'local-source');
    mkdirSync(path.join(local, 'skills', 'alpha'), { recursive: true });
    writeFileSync(path.join(local, 'skills', 'alpha', 'SKILL.md'), skillMarkdown('alpha', 'locally added'));
    const install = run(['add', local, '--skill', 'alpha', '--yes']);
    expect(install.status, install.stderr).toBe(0);
    expect(registrySource().type).toBe('local');
    expect(installedSkillMd()).not.toContain('metadata:');

    // Any later write point (title edit) still writes no fake evidence.
    const edit = run(['edit', 'alpha', '--title', 'Renamed']);
    expect(edit.status, edit.stderr).toBe(0);
    expect(installedSkillMd()).not.toContain('metadata:');
    expect(installedSkillMd()).not.toMatch(/skills-manager-written-by|github-/);
  });
});
