import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cli, cliEnv } from './cli-runner.js';

/** `web` / `dashboard --port` is validated up front (before the hub probe or any server start). */

let userHome: string;
beforeEach(() => { userHome = mkdtempSync(path.join(tmpdir(), 'port-')); });
afterEach(() => rmSync(userHome, { recursive: true, force: true }));

describe('dashboard --port validation', () => {
  it.each(['abc', '70000', '-1', '4777x', '1.5'])('rejects --port %s', (port) => {
    const r = spawnSync(process.execPath, [cli, 'web', '--port', port, '--no-open'], { cwd: userHome, encoding: 'utf8', env: cliEnv(userHome), timeout: 10000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('--port expects an integer from 0 to 65535');
    expect(r.stderr).not.toContain('No skill home');
  });

  it('accepts a valid port (then reports the missing hub)', () => {
    const r = spawnSync(process.execPath, [cli, 'web', '--port', '4999', '--no-open'], { cwd: userHome, encoding: 'utf8', env: cliEnv(userHome), timeout: 10000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('No skill home');
  });
});
