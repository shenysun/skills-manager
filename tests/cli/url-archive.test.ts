import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';
import { buildTarGz, buildZip, skillMarkdown } from '../fixtures/archives.js';
import { closeWireServers, serveWire } from '../fixtures/wire-http.js';

/**
 * CLI surface for archive URL sources (source-formats ticket 04): the one-step
 * `add <url> --all` install of zip/tar.gz payloads over the real download
 * transport (a local wire server), and the --format escape hatch when neither
 * extension nor Content-Type identifies the payload.
 */

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'url-archive-cli-'));
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

describe('add with an archive URL', () => {
  it('installs a .zip URL with --all --yes, recording url provenance', async () => {
    const zip = buildZip([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha', 'from a zip url') }]);
    const baseUrl = await serveWire({ kind: 'file', body: zip, contentType: 'application/zip' });
    const install = run(['add', `${baseUrl}/pack.zip`, '--all', '--yes']);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout).installed).toEqual(['alpha']);

    const entry = JSON.parse(run(['list']).stdout).find((skill: { name: string }) => skill.name === 'alpha');
    expect(entry.source.type).toBe('url');
    expect(entry.source.upstream_tree).toBeNull();
  });

  it('installs a .tar.gz URL the same way', async () => {
    const tarGz = buildTarGz([{ name: 'alpha/SKILL.md', data: skillMarkdown('alpha', 'from a tar.gz url') }]);
    const baseUrl = await serveWire({ kind: 'file', body: tarGz, contentType: 'application/gzip' });
    const install = run(['add', `${baseUrl}/pack.tar.gz`, '--all', '--yes']);
    expect(install.status, install.stderr).toBe(0);
    expect(JSON.parse(install.stdout).installed).toEqual(['alpha']);
  });

  it('rescues a mislabeled URL with --format md when the extension contradicts the content', async () => {
    // A .zip URL serving a single SKILL.md: prediction says zip, content is
    // md — the mismatch refuses the auto path and --format md is the hatch.
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha', 'mislabeled') });
    const failed = run(['add', `${baseUrl}/pack.zip`, '--all', '--yes']);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toMatch(/--format md/);

    const forced = run(['add', `${baseUrl}/pack.zip`, '--all', '--yes', '--format', 'md']);
    expect(forced.status, forced.stderr).toBe(0);
    expect(JSON.parse(forced.stdout).installed).toEqual(['alpha']);
  });

  it('refuses a --format value outside md|zip|tar before anything is fetched', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: skillMarkdown('alpha') });
    const result = run(['add', `${baseUrl}/SKILL.md`, '--all', '--yes', '-f', 'rar']);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--format/);
  });
});
