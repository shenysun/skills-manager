import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { closeWireServers, serveWire } from '../fixtures/wire-http.js';

/**
 * CLI seam of detection-calibration mirror backfill (provenance-get ticket 04,
 * ADR-0017 / US5): a pre-mirror legacy row carries no frontmatter evidence —
 * the next `update --check` that calibrates its anchor (url content-sha,
 * wellknown digest) lands the mirror in the same motion, with no migration or
 * backfill command anywhere. The backfilled bytes then propagate to copy
 * targets exactly like any content change: fingerprint-honest stale marking
 * plus the existing auto-refresh channel (US17).
 */

const V2_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

const sha256 = (data: string | Buffer) => `sha256:${createHash('sha256').update(data).digest('hex')}`;

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'mirror-calibration-'));
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

/** Lay a pre-ADR-0017 row down by hand: hub skill + registry.yaml exactly as a
 *  pre-mirror install left them (no mirror, no anchor) — going through any CLI
 *  write point would already project the mirror. */
function legacyRow(sourceYaml: string, description: string, skill = 'alpha') {
  const dir = path.join(home, 'skills', skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'SKILL.md'), skillMarkdown(skill, description));
  writeFileSync(path.join(home, 'registry.yaml'), [
    'skills:',
    `  ${skill}:`,
    `    path: skills/${skill}`,
    `    title: ${skill}`,
    '    category: experimental',
    '    tags: []',
    '    consumers: []',
    `    source: ${sourceYaml}`,
    '    update_policy: manual',
    `    description: ${description}`,
    '',
  ].join('\n'));
}

/** The legacy url row this suite calibrates: direct-download source, no anchor,
 *  no mirror. */
function legacyUrlRow(downloadUrl: string) {
  legacyRow(`{type: url, url: '${downloadUrl}', subpath: skills/alpha, ref: null, upstream_commit: null, upstream_tree: null}`, 'from a url');
}

describe('update --check calibration backfills the mirror (US5)', () => {
  it('a legacy url row adopts its content-sha anchor and grows the mirror in the same check', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha', 'from a url') });
    legacyUrlRow(`${baseUrl}/SKILL.md`);
    expect(installedSkillMd()).not.toContain('metadata:');

    const check = JSON.parse(run(['update', '--check']).stdout);

    // First calibration flags no update — the observed hash IS the installed content.
    expect(check.upToDate).toContain('alpha');
    const source = registrySource();
    expect(source.upstream_content_sha).toMatch(/^sha256:[0-9a-f]{64}$/);
    const skillMd = installedSkillMd();
    expect(skillMd).toContain(`skills-manager-source-url: ${baseUrl}/SKILL.md\n`);
    expect(skillMd).toContain(`skills-manager-content-sha: ${source.upstream_content_sha}\n`);
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');
  });

  it('a legacy wellknown row adopts its digest anchor and grows the mirror in the same check', async () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const digest = sha256(body);
    const base = await serveWire({
      kind: 'routes',
      routes: {
        '/.well-known/agent-skills/index.json': JSON.stringify({ $schema: V2_SCHEMA, skills: [{ name: 'alpha', description: 'an indexed skill', type: 'skill-md', url: 'files/alpha.md', digest }] }),
        '/.well-known/agent-skills/files/alpha.md': body,
      },
    });
    legacyRow(`{type: wellknown, url: '${base}/.well-known/agent-skills/index.json', subpath: alpha, ref: null, upstream_commit: null, upstream_tree: null}`, 'an indexed skill');
    expect(installedSkillMd()).not.toContain('metadata:');

    const check = JSON.parse(run(['update', '--check']).stdout);

    expect(check.upToDate).toContain('alpha');
    expect(registrySource().upstream_digest).toBe(digest);
    const skillMd = installedSkillMd();
    expect(skillMd).toContain(`skills-manager-source-url: ${base}/.well-known/agent-skills/index.json\n`);
    expect(skillMd).toContain(`skills-manager-digest: ${digest}\n`);
    expect(skillMd).toContain('skills-manager-written-by: skills-manager-cli\n');

    // Idempotent: the digest-anchored row rewrites nothing on its next check.
    const registry = readFileSync(path.join(home, 'registry.yaml'), 'utf8');
    const again = JSON.parse(run(['update', '--check']).stdout);
    expect(again.upToDate).toContain('alpha');
    expect(readFileSync(path.join(home, 'registry.yaml'), 'utf8')).toBe(registry);
    expect(installedSkillMd()).toBe(skillMd);
  });

  it('is idempotent: a second check of the calibrated row rewrites neither registry nor SKILL.md', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha', 'from a url') });
    legacyUrlRow(`${baseUrl}/SKILL.md`);
    run(['update', '--check']);
    const registry = readFileSync(path.join(home, 'registry.yaml'), 'utf8');
    const skillMd = installedSkillMd();

    const again = JSON.parse(run(['update', '--check']).stdout);

    expect(again.upToDate).toContain('alpha');
    expect(readFileSync(path.join(home, 'registry.yaml'), 'utf8')).toBe(registry);
    expect(installedSkillMd()).toBe(skillMd);
  });

  it('offers no migration or backfill command: the mirror only ever grows inside existing flows', () => {
    const help = run(['--help']);
    expect(help.status, help.stderr).toBe(0);
    // Enumerate the actual command names — a differently-named mirror sync
    // (e.g. `mirror-sync`) must not slip past, while existing descriptions
    // legitimately mention the mirror.
    const commandNames = (help.stdout.split('Commands:')[1]?.split('Options:')[0] ?? '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(commandNames.length).toBeGreaterThan(0);
    expect(commandNames.filter((name) => /mirror|backfill/i.test(name))).toEqual([]);
  });
});

describe('the backfilled mirror propagates to copy targets (US17)', () => {
  it('marks distributed copies stale via the unchanged fingerprint semantics and the existing refresh syncs them', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha', 'from a url') });
    legacyUrlRow(`${baseUrl}/SKILL.md`);
    const distribute = run(['distribute', '--to', 'user', '--skill', 'alpha', '--agent', 'zed', '--mode', 'copy']);
    expect(distribute.status, distribute.stderr).toBe(0);
    const copyPath = path.join(userHome, '.agents', 'skills', 'alpha', 'SKILL.md');
    expect(readFileSync(copyPath, 'utf8')).not.toContain('metadata:');

    // Calibration lands the mirror — the hub fingerprint honestly moves with it.
    const check = run(['update', '--check']);
    expect(check.status, check.stderr).toBe(0);
    expect(installedSkillMd()).toContain('skills-manager-content-sha:');
    const status = run(['status']);
    expect(status.stdout).toMatch(/outdated: 1\b/);

    // The existing auto-refresh channel carries the mirrored file to the copy.
    const refresh = run(['redistribute', '--refresh']);
    expect(refresh.status, refresh.stderr).toBe(0);
    expect(readFileSync(copyPath, 'utf8')).toBe(installedSkillMd());
    expect(run(['status']).stdout).toMatch(/outdated: 0/);
  });
});
