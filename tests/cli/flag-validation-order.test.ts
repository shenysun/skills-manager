import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cli, cliEnv } from './cli-runner.js';

/**
 * Bad flags must be reported as flag errors even before the default hub exists
 * (no --home, empty user home), instead of the generic "No skill home" error.
 */

let root: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'flag-order-'));
  userHome = path.join(root, 'user-home');
  mkdirSync(userHome, { recursive: true });
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('flag validation runs before hub resolution', () => {
  it.each([
    [['cost', '--budget', 'abc'], '--budget expects'],
    [['cost', '--top', 'abc'], '--top expects'],
    [['cost', '--json', '--share'], 'either --json or --share'],
    [['update', '--fail-on-stale'], '--fail-on-stale requires --check'],
  ])('%j → %s', (args, message) => {
    const r = spawnSync(process.execPath, [cli, ...args], { cwd: userHome, encoding: 'utf8', env: cliEnv(userHome) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(message);
    expect(r.stderr).not.toContain('No skill home');
  });
});
