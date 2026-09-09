import type { GitCloneOptions, GitLogEntry, GitPort } from '../core/ports/git.js';
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
      if (error instanceof CommandTimeoutError) throw this.transportTimeout(error);
      throw networkFailure;
    }
  }

  /** ms left on the deadline, floored at 1: `spawnSync` treats 0 as "no limit". */
  private remainingMs(deadline: number): number {
    return Math.max(1, deadline - this.clock());
  }

  private transportTimeout(error: CommandTimeoutError): Error {
    return new Error(
      `${error.message}\n` +
        'The git transport stalled. Raise SKILLS_MANAGER_CLONE_TIMEOUT_MS (milliseconds) ' +
        'or clone the repository manually and pass the local path instead.',
    );
  }

  private cloneTimeoutMs(): number {
    const raw = Number(this.env.SKILLS_MANAGER_CLONE_TIMEOUT_MS);
    return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_CLONE_TIMEOUT_MS;
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

  listRemoteHeads(repoUrl: string): string[] {
    const output = this.runner.runOrThrow('git', ['ls-remote', '--heads', repoUrl]);
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
}
