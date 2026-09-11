import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './cli-runner.js';

/** External behaviour of `skills-manager echo` — /bin/echo semantics, no side effects. */

let root: string;
let home: string;
let userHome: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'skills-echo-'));
  home = path.join(root, 'hub');
  userHome = path.join(root, 'user-home');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('echo (smoke-test ticket 01)', () => {
  it('joins operands with single spaces and prints them to stdout, exit 0', () => {
    const result = runCli(home, userHome, ['echo', 'hello', 'world']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('hello world\n');
    expect(result.stderr).toBe('');
  });

  it('prints a bare newline for zero operands and exits 0 (/bin/echo semantics)', () => {
    const result = runCli(home, userHome, ['echo']);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('\n');
    expect(result.stderr).toBe('');
  });

  it('creates nothing: a missing hub stays missing after the run', () => {
    runCli(home, userHome, ['echo', 'ping']);

    expect(existsSync(home), 'echo must not create the hub').toBe(false);
  });
});
