import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { closeWireServers, serveWire } from '../fixtures/wire-http.js';

/**
 * CLI surface for well-known discovery-index sources (source-formats ticket
 * 10, spec Testing Decisions): the one-step `add <site> --all` install through
 * the V2 probe over the real download transport (a local wire server with real
 * routing), the digest anchor landing in the registry, and an artifact that
 * breaks the index's digest promise refusing the install.
 */

const V2_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

function sha256(data: string): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`;
}

function wellknownIndex(entries: unknown[]): string {
  return JSON.stringify({ $schema: V2_SCHEMA, skills: entries });
}

function alphaEntry(digest: string) {
  return { name: 'alpha', description: 'an indexed skill', type: 'skill-md', url: 'files/alpha.md', digest };
}

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'wellknown-source-cli-'));
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

describe('add with a well-known discovery index', () => {
  it('installs with --all --yes, recording wellknown provenance with the digest anchor', async () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const base = await serveWire({
      kind: 'routes',
      routes: {
        '/.well-known/agent-skills/index.json': wellknownIndex([alphaEntry(sha256(body))]),
        '/.well-known/agent-skills/files/alpha.md': body,
      },
    });
    const install = run(['add', `${base}/`, '--all', '--yes']);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout).installed).toEqual(['alpha']);

    const entry = JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(entry.source.type).toBe('wellknown');
    expect(entry.source.upstream_digest).toBe(sha256(body));
    expect(entry.source.upstream_commit).toBeNull();
    expect(entry.source.upstream_tree).toBeNull();
  });

  it('refuses an artifact whose bytes break the index digest promise', async () => {
    const body = skillMarkdown('alpha', 'an indexed skill');
    const base = await serveWire({
      kind: 'routes',
      routes: {
        '/.well-known/agent-skills/index.json': wellknownIndex([alphaEntry(sha256(body))]),
        '/.well-known/agent-skills/files/alpha.md': `${body}\n<!-- tampered -->`,
      },
    });
    const result = run(['add', `${base}/`, '--all', '--yes']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not match the digest/);
    expect(JSON.parse(run(['list']).stdout)).toEqual([]);
  });
});
