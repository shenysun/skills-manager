import type { GitCloneOptions, GitLogEntry, GitPort } from '../core/ports/git.js';
import { ShellRunner } from './shell-runner.js';
import { HTTP1_RETRY_ENV, isRetryableTransportFailure } from './git-transport-retry.js';

const FULL_COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
/** Git's own abbreviation floor: `git checkout` prints short SHAs at 7+ chars. */
const ABBREVIATED_SHA_PATTERN = /^[0-9a-f]{7,39}$/i;
const SHALLOW_DEPTH = 1;

export class GitCli implements GitPort {
  constructor(private readonly runner = new ShellRunner()) {}

  clone(repoUrl: string, destination: string, options: GitCloneOptions = {}): void {
    const depth = options.depth ?? SHALLOW_DEPTH;
    if (options.ref && this.isBareCommitRef(repoUrl, options.ref)) {
      this.fetchShallowCommit(repoUrl, destination, options.ref, depth);
      return;
    }
    const args = ['clone', `--depth=${depth}`, ...(options.ref ? ['--branch', options.ref] : []), repoUrl, destination];
    this.runTransport('git', args);
  }

  /** A bare commit SHA cannot go through `--branch` — but a 7-39 hex string may
   *  also be a hex-shaped ref (a date tag like `20260909`). Resolve it the way
   *  `git checkout` does: a remote ref of that name wins over the SHA reading. */
  private isBareCommitRef(repoUrl: string, ref: string): boolean {
    if (FULL_COMMIT_SHA_PATTERN.test(ref)) return true;
    if (!ABBREVIATED_SHA_PATTERN.test(ref)) return false;
    return this.runner.runOrThrow('git', ['ls-remote', repoUrl, ref]).trim() === '';
  }

  /** `git clone` cannot target a bare SHA — init + fetch the commit shallow, then check it out (ADR-0013). */
  private fetchShallowCommit(repoUrl: string, destination: string, sha: string, depth: number): void {
    this.runner.runOrThrow('git', ['init', destination]);
    this.runner.runOrThrow('git', ['-C', destination, 'remote', 'add', 'origin', repoUrl]);
    this.runTransport('git', ['-C', destination, 'fetch', `--depth=${depth}`, 'origin', sha]);
    this.runner.runOrThrow('git', ['-C', destination, 'checkout', sha]);
  }

  /**
   * Transport commands retry exactly once over HTTP/1.1 when the failure is
   * network-class (ADR-0013); a failed retry rethrows the original error.
   */
  private runTransport(command: string, args: string[]): void {
    let networkFailure: unknown;
    try {
      this.runner.runOrThrow(command, args);
      return;
    } catch (error) {
      if (!isRetryableTransportFailure(error)) throw error;
      networkFailure = error;
    }
    try {
      this.runner.runOrThrow(command, args, { env: { ...HTTP1_RETRY_ENV } });
    } catch {
      throw networkFailure;
    }
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
