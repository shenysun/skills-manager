import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GitCli } from '../../src/infra/git-cli.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const URL = 'https://github.com/owner/repo.git';

function recordingCli() {
  const commands: string[] = [];
  const record = (command: string, args: string[]) => {
    commands.push([command, ...args].join(' '));
    return { status: 0, stdout: '', stderr: '' };
  };
  const runner = {
    run: record,
    runOrThrow: (command: string, args: string[]) => String(record(command, args).stdout.trim()),
  } as never;
  return { commands, cli: new GitCli(runner) };
}

const HTTP1_ENV = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.version',
  GIT_CONFIG_VALUE_0: 'HTTP/1.1',
};

type RunnerCall = { command: string; args: string[]; options?: { env?: Record<string, string> } };

/** Runner fake whose n-th `runOrThrow` throws the n-th scripted failure (undefined = success). */
function scriptedCli(failures: ReadonlyArray<unknown>) {
  const calls: RunnerCall[] = [];
  const runner = {
    run: (command: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ command, args, options });
      return { status: 0, stdout: '', stderr: '' };
    },
    runOrThrow: (command: string, args: string[], options?: { cwd?: string; env?: Record<string, string> }) => {
      calls.push({ command, args, options });
      const failure = failures[calls.length - 1];
      if (failure !== undefined) throw failure;
      return '';
    },
  };
  return { calls, cli: new GitCli(runner as never) };
}

const CURL_92 = new Error(
  `Command failed: git clone --depth=1 ${URL} /tmp/repo\nfatal: unable to access '${URL}/': curl 92 HTTP/2 stream 0 was not closed cleanly: BEFORE_STREAM (err 99)`,
);
const CURL_56 = new Error(
  `Command failed: git -C /tmp/repo fetch --depth=1 origin ${SHA}\nerror: RPC failed; curl 56 Recv failure: Connection reset by peer`,
);
const REPOSITORY_NOT_FOUND = new Error(
  `Command failed: git clone --depth=1 ${URL} /tmp/repo\nERROR: Repository not found.\nfatal: Could not read from remote repository.`,
);

describe('GitCli.clone (shallow transport, ADR-0013)', () => {
  it('clones the default branch with depth 1 when no ref is given', () => {
    const { commands, cli } = recordingCli();
    cli.clone(URL, '/tmp/repo');
    expect(commands).toEqual([`git clone --depth=1 ${URL} /tmp/repo`]);
  });

  it('carries a branch or tag ref via --branch', () => {
    const branch = recordingCli();
    branch.cli.clone(URL, '/tmp/repo', { ref: 'develop' });
    expect(branch.commands).toEqual([`git clone --depth=1 --branch develop ${URL} /tmp/repo`]);

    const tag = recordingCli();
    tag.cli.clone(URL, '/tmp/repo', { ref: 'v1.2.0' });
    expect(tag.commands).toEqual([`git clone --depth=1 --branch v1.2.0 ${URL} /tmp/repo`]);
  });

  it('treats a 40-char non-hex ref as a branch name, not a SHA', () => {
    const { commands, cli } = recordingCli();
    const ref = 'g'.repeat(40);
    cli.clone(URL, '/tmp/repo', { ref });
    expect(commands).toEqual([`git clone --depth=1 --branch ${ref} ${URL} /tmp/repo`]);
  });

  it('fetches a bare commit SHA via init + remote + shallow fetch + checkout', () => {
    const { commands, cli } = recordingCli();
    cli.clone(URL, '/tmp/repo', { ref: SHA });
    expect(commands).toEqual([
      'git init /tmp/repo',
      `git -C /tmp/repo remote add origin ${URL}`,
      `git -C /tmp/repo fetch --depth=1 origin ${SHA}`,
      `git -C /tmp/repo checkout ${SHA}`,
    ]);
  });

  it('recognizes an uppercase commit SHA', () => {
    const { commands, cli } = recordingCli();
    cli.clone(URL, '/tmp/repo', { ref: SHA.toUpperCase() });
    expect(commands).toContain(`git -C /tmp/repo fetch --depth=1 origin ${SHA.toUpperCase()}`);
  });

  it('disambiguates an abbreviated hex ref via ls-remote and fetches it as a SHA when no remote ref matches', () => {
    const { commands, cli } = recordingCli();
    cli.clone(URL, '/tmp/repo', { ref: 'd8e341c' });
    expect(commands).toEqual([
      `git ls-remote ${URL} d8e341c`,
      'git init /tmp/repo',
      `git -C /tmp/repo remote add origin ${URL}`,
      'git -C /tmp/repo fetch --depth=1 origin d8e341c',
      'git -C /tmp/repo checkout d8e341c',
    ]);
  });

  it('keeps a hex-shaped ref that exists remotely (e.g. a date tag) on the --branch path', () => {
    const commands: string[] = [];
    const runner = {
      run: (command: string, args: string[]) => {
        commands.push([command, ...args].join(' '));
        return { status: 0, stdout: '', stderr: '' };
      },
      runOrThrow: (command: string, args: string[]) => {
        commands.push([command, ...args].join(' '));
        if (args[0] === 'ls-remote') return `${SHA}\trefs/tags/20260909`;
        return '';
      },
    };
    new GitCli(runner as never).clone(URL, '/tmp/repo', { ref: '20260909' });
    expect(commands).toEqual([
      `git ls-remote ${URL} 20260909`,
      `git clone --depth=1 --branch 20260909 ${URL} /tmp/repo`,
    ]);
  });

  it('honors an explicit depth on both the clone and the SHA fetch', () => {
    const clone = recordingCli();
    clone.cli.clone(URL, '/tmp/repo', { depth: 3 });
    expect(clone.commands).toEqual([`git clone --depth=3 ${URL} /tmp/repo`]);

    const fetch = recordingCli();
    fetch.cli.clone(URL, '/tmp/repo', { ref: SHA, depth: 5 });
    expect(fetch.commands).toContain(`git -C /tmp/repo fetch --depth=5 origin ${SHA}`);
  });
});

describe('GitCli transport retry (HTTP/1.1 once, ticket 02 / ADR-0013)', () => {
  it('retries a network-class clone failure exactly once with the HTTP/1.1 env injected', () => {
    const { calls, cli } = scriptedCli([CURL_92]);
    cli.clone(URL, '/tmp/repo');

    expect(calls).toHaveLength(2);
    expect(calls[0].options).toBeUndefined();
    expect(calls[1].args).toEqual(calls[0].args);
    expect(calls[1].options?.env).toEqual(HTTP1_ENV);
  });

  it('rethrows the original error when the HTTP/1.1 retry fails too', () => {
    const { calls, cli } = scriptedCli([CURL_92, CURL_56]);
    let thrown: unknown;
    try {
      cli.clone(URL, '/tmp/repo');
    } catch (error) {
      thrown = error;
    }

    expect(calls).toHaveLength(2);
    expect(thrown).toBe(CURL_92);
  });

  it('does not retry deterministic failures such as repository-not-found', () => {
    const { calls, cli } = scriptedCli([REPOSITORY_NOT_FOUND]);
    expect(() => cli.clone(URL, '/tmp/repo')).toThrow(REPOSITORY_NOT_FOUND);
    expect(calls).toHaveLength(1);
  });

  it('retries only the fetch leg of the bare-SHA path and leaves checkout untouched', () => {
    const { calls, cli } = scriptedCli([undefined, undefined, CURL_92]);
    cli.clone(URL, '/tmp/repo', { ref: SHA });

    expect(calls).toHaveLength(5);
    expect(calls[2].args).toEqual(['-C', '/tmp/repo', 'fetch', '--depth=1', 'origin', SHA]);
    expect(calls[3].args).toEqual(calls[2].args);
    expect(calls[3].options?.env).toEqual(HTTP1_ENV);
    expect(calls[4].args).toEqual(['-C', '/tmp/repo', 'checkout', SHA]);
    expect(calls[4].options).toBeUndefined();
  });

  it('never retries local commands (init) even if their failure wording looks network-like', () => {
    const { calls, cli } = scriptedCli([CURL_92]);
    expect(() => cli.clone(URL, '/tmp/repo', { ref: SHA })).toThrow(CURL_92);
    expect(calls).toHaveLength(1);
  });
});

describe('GitCli.revParseTree (source anchor, ADR-0013)', () => {
  it('resolves the sub-directory tree SHA at HEAD — against a real shallow clone', () => {
    // Real git, not a recording fake: git's revision parser rejects
    // `HEAD:<path>^{tree}` (the `^{tree}` is swallowed into the path), which a
    // command-shape assertion cannot see — this bug shipped because of one.
    const root = mkdtempSync(path.join(tmpdir(), 'rev-parse-tree-'));
    try {
      const source = path.join(root, 'source');
      const git = (args: string[]) => execFileSync('git', args, { cwd: source });
      mkdirSync(path.join(source, 'skills', 'alpha'), { recursive: true });
      writeFileSync(path.join(source, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n');
      git(['init']);
      git(['add', '.']);
      git(['commit', '-m', 'init']);
      const cloneDir = path.join(root, 'clone');
      new GitCli().clone(source, cloneDir);
      const treeSha = new GitCli().revParseTree(cloneDir, 'skills/alpha');
      expect(treeSha).toMatch(/^[0-9a-f]{40}$/);
      expect(treeSha).toBe(execFileSync('git', ['-C', source, 'rev-parse', 'HEAD:skills/alpha'], { encoding: 'utf8' }).trim());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
