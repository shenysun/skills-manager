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

  it('honors an explicit depth on both the clone and the SHA fetch', () => {
    const clone = recordingCli();
    clone.cli.clone(URL, '/tmp/repo', { depth: 3 });
    expect(clone.commands).toEqual([`git clone --depth=3 ${URL} /tmp/repo`]);

    const fetch = recordingCli();
    fetch.cli.clone(URL, '/tmp/repo', { ref: SHA, depth: 5 });
    expect(fetch.commands).toContain(`git -C /tmp/repo fetch --depth=5 origin ${SHA}`);
  });
});
