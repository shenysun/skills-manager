import type { GitCloneOptions, GitDiffEntry, GitLogEntry, GitPort } from '../core/ports/git.js';
import { CommandTimeoutError, ShellRunner } from './shell-runner.js';
import { HTTP1_RETRY_ENV, isRetryableTransportFailure } from './git-transport-retry.js';

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
/** Git's own abbreviation floor: `git checkout` prints short SHAs at 7+ chars. */
const ABBREVIATED_SHA_PATTERN = /^[0-9a-f]{7,39}$/i;
const SHALLOW_DEPTH = 1;
/** Wall-clock ceiling for one whole clone operation (ticket 08) — a real network
 *  once stalled a clone for 9.5 minutes with no output at all. */
const DEFAULT_CLONE_TIMEOUT_MS = 300_000;

export class GitCli implements GitPort {
  constructor(
    private readonly runner = new ShellRunner(),
    private readonly clock: () => number = Date.now,
    private readonly env: Record<string, string | undefined> = process.env,
  ) {}

  clone(repoUrl: string, destination: string, options: GitCloneOptions = {}): void {
    const deadline = this.clock() + this.cloneTimeoutMs();
    const depth = options.depth ?? SHALLOW_DEPTH;
    if (options.ref && this.isBareCommitRef(repoUrl, options.ref, deadline)) {
      this.fetchShallowCommit(repoUrl, destination, options.ref, depth, deadline);
      return;
    }
    const args = ['clone', `--depth=${depth}`, ...(options.ref ? ['--branch', options.ref] : []), repoUrl, destination];
    this.runTransport('git', args, deadline);
  }

  /** A bare commit SHA cannot go through `--branch` — but a 7-39 hex string may
   *  also be a hex-shaped ref (a date tag like `20260909`). Resolve it the way
   *  `git checkout` does: a remote ref of that name wins over the SHA reading. */
  private isBareCommitRef(repoUrl: string, ref: string, deadline: number): boolean {
    if (FULL_COMMIT_SHA_PATTERN.test(ref)) return true;
    if (!ABBREVIATED_SHA_PATTERN.test(ref)) return false;
    return this.runTransport('git', ['ls-remote', repoUrl, ref], deadline).trim() === '';
  }

  /** `git clone` cannot target a bare SHA — init + fetch the commit shallow, then check it out (ADR-0013). */
  private fetchShallowCommit(repoUrl: string, destination: string, sha: string, depth: number, deadline: number): void {
    this.runner.runOrThrow('git', ['init', destination]);
    this.runner.runOrThrow('git', ['-C', destination, 'remote', 'add', 'origin', repoUrl]);
    this.runTransport('git', ['-C', destination, 'fetch', `--depth=${depth}`, 'origin', sha], deadline);
    this.runner.runOrThrow('git', ['-C', destination, 'checkout', sha]);
  }

  /**
   * Transport commands retry exactly once over HTTP/1.1 when the failure is
   * network-class (ADR-0013); a failed retry rethrows the original error. The
   * whole attempt pair shares one deadline (ticket 08): a retry gets only the
   * budget the first attempt left behind, and a stall past the deadline is
   * never retried — HTTP/1.1 does not unstick a dead connection.
   */
  private runTransport(command: string, args: string[], deadline: number): string {
    let networkFailure: unknown;
    try {
      return this.runner.runOrThrow(command, args, { timeoutMs: this.remainingMs(deadline) });
    } catch (error) {
      if (error instanceof CommandTimeoutError) throw this.transportTimeout(error);
      if (!isRetryableTransportFailure(error)) throw error;
      networkFailure = error;
    }
    try {
      return this.runner.runOrThrow(command, args, {
        env: { ...HTTP1_RETRY_ENV },
        timeoutMs: this.remainingMs(deadline),
      });
    } catch (error) {
      if (error instanceof CommandTimeoutError) throw this.transportTimeout(error, networkFailure);
      throw networkFailure;
    }
  }

  /** ms left on the deadline, floored at 1: `spawnSync` treats 0 as "no limit". */
  private remainingMs(deadline: number): number {
    return Math.max(1, deadline - this.clock());
  }

  /** The retry's own timeout keeps the original network failure in the message —
   *  "timed out after 1ms" alone would hide why the first attempt died (adversary L1). */
  private transportTimeout(error: CommandTimeoutError, cause?: unknown): Error {
    const causeLine = cause instanceof Error
      ? `Original failure before the budget ran out: ${cause.message.split('\n')[0]}\n`
      : '';
    return new Error(
      `${error.message}\n${causeLine}` +
        'The git transport stalled. Raise SKILLS_MANAGER_CLONE_TIMEOUT_MS (milliseconds) ' +
        'or clone the repository manually and pass the local path instead.',
    );
  }

  /** Strict digit-string parsing: Number("1.0") is the integer 1, which would
   *  accept a 1ms budget through the back door (adversary L2). */
  private cloneTimeoutMs(): number {
    const raw = this.env.SKILLS_MANAGER_CLONE_TIMEOUT_MS;
    return typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_CLONE_TIMEOUT_MS;
  }

  revParseHead(repoDir: string): string {
    return this.runner.runOrThrow('git', ['-C', repoDir, 'rev-parse', 'HEAD']);
  }

  /** `HEAD:<dir>` already resolves to the directory's tree object — git's
   *  revision parser rejects a `^{tree}` suffix after the `:<path>` arm
   *  (`path 'x^{tree}' does not exist`), it must not be appended here. */
  revParseTree(repoDir: string, subpath: string): string {
    return this.runner.runOrThrow('git', ['-C', repoDir, 'rev-parse', `HEAD:${subpath}`]);
  }

  /** Branch discovery for GitHub tree URLs — an import-path transport like any
   *  other: it gets the clone budget and retry semantics (adversary M3), so a
   *  dead connection fails the import instead of hanging it. */
  listRemoteHeads(repoUrl: string): string[] {
    const deadline = this.clock() + this.cloneTimeoutMs();
    const output = this.runTransport('git', ['ls-remote', '--heads', repoUrl], deadline);
    return output.split('\n')
      .map((line) => line.match(/refs\/heads\/(.+)$/)?.[1])
      .filter((value): value is string => Boolean(value));
  }

  statusShort(cwd: string): string {
    const result = this.runner.run('git', ['-C', cwd, 'status', '--short']);
    return result.status === 0 ? result.stdout.trim() : '';
  }

  log(cwd: string, maxCount: number): GitLogEntry[] {
    const result = this.runner.run('git', ['-C', cwd, 'log', `--max-count=${maxCount}`, '--date=iso-strict', '--pretty=format:%H%x09%cI%x09%s']);
    if (result.status !== 0) return [];
    return result.stdout.split('\n').filter(Boolean).map((line) => {
      const [hash, timestamp, ...subject] = line.split('\t');
      return { hash, timestamp, subject: subject.join('\t') };
    });
  }

  // Hub sync plumbing (ADR-0020). These are repo-local commands, not transports:
  // no clone budget, no retry semantics — git answering "no" is an answer.

  available(): boolean {
    return this.runner.run('git', ['--version']).status === 0;
  }

  initRepo(cwd: string): void {
    this.runner.runOrThrow('git', ['-C', cwd, 'init']);
  }

  remoteUrl(cwd: string, name: string): string | null {
    const result = this.runner.run('git', ['-C', cwd, 'remote', 'get-url', name]);
    return result.status === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : null;
  }

  remoteAdd(cwd: string, name: string, url: string): void {
    this.runner.runOrThrow('git', ['-C', cwd, 'remote', 'add', name, url]);
  }

  statusPorcelain(cwd: string): string {
    return this.runner.runOrThrow('git', ['-C', cwd, 'status', '--porcelain', '-uall']).trim();
  }

  addAll(cwd: string): void {
    this.runner.runOrThrow('git', ['-C', cwd, 'add', '-A']);
  }

  commit(cwd: string, message: string): string {
    this.runner.runOrThrow('git', ['-C', cwd, 'commit', '-m', message]);
    return this.revParseHead(cwd);
  }

  /** `@{upstream}...HEAD` with `--left-right --count` yields "behind\tahead"
   *  off the remote-tracking ref — local objects only, no fetch. An
   *  unresolvable upstream is git's own fatal for this read ("no upstream
   *  configured", or "no such branch" on an unborn HEAD) and maps to null;
   *  any other refusal throws (strict), and the counts are parsed only from
   *  the exact two-integer shape — malformed output never silently reads as
   *  zero. */
  aheadBehind(cwd: string): { ahead: number; behind: number } | null {
    const args = ['-C', cwd, 'rev-list', '--left-right', '--count', '@{upstream}...HEAD'];
    const result = this.runner.run('git', args);
    if (result.status !== 0) {
      if (/no upstream configured|does not have an upstream|no such branch/i.test(result.stderr)) return null;
      throw new Error(`Command failed: git ${args.join(' ')}\n${result.stderr || result.stdout}`);
    }
    const output = result.stdout.trim();
    const parsed = output.match(/^(\d+)\t(\d+)$/);
    if (parsed === null) throw new Error(`Command failed: git ${args.join(' ')}\nunparseable output: ${output}`);
    return { behind: Number(parsed[1]), ahead: Number(parsed[2]) };
  }

  /** NUL records: `A\0path` or `R100\0old\0new` — a two-path shape the tab
   *  format would quoting-mangle. The trailing NUL leaves one empty token,
   *  which the reader skips rather than miscounting as a path. */
  diffNameStatus(cwd: string, ref: string): GitDiffEntry[] {
    const output = this.runner.runOrThrow('git', ['-C', cwd, 'diff', '--name-status', '-z', ref]);
    const tokens = output.split('\0');
    const entries: GitDiffEntry[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const code = tokens[i];
      if (code === '' || code === undefined) continue;
      const twoPaths = code.startsWith('R') || code.startsWith('C');
      entries.push(twoPaths ? { code, paths: [tokens[i + 1], tokens[i + 2]] } : { code, paths: [tokens[i + 1]] });
      i += twoPaths ? 2 : 1;
    }
    return entries;
  }

  lsTreeNames(cwd: string, ref: string, subpath: string): string[] {
    const output = this.runner.runOrThrow('git', ['-C', cwd, 'ls-tree', '--name-only', ref, `${subpath}/`]);
    // The pathspec form prints full paths (`skills/demo`) — the caller asked
    // for child names, and this form (unlike the `ref:subpath` tree-ish) stays
    // exit-0 empty when the path is absent at that ref.
    const prefix = `${subpath}/`;
    return output.split('\n').filter(Boolean).map((name) => {
      const trimmed = name.replace(/\/$/, '');
      return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
    });
  }

  pushOrigin(cwd: string): string {
    const result = this.runner.run('git', ['-C', cwd, 'push', '-u', 'origin', 'HEAD']);
    if (result.status !== 0) {
      throw new Error(`Command failed: git push -u origin HEAD\n${result.stderr || result.stdout}`);
    }
    return `${result.stdout}\n${result.stderr}`.trim();
  }
}
