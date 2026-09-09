import type { GitCloneOptions, GitLogEntry, GitPort } from '../core/ports/git.js';
import { ShellRunner } from './shell-runner.js';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const SHALLOW_DEPTH = 1;

export class GitCli implements GitPort {
  constructor(private readonly runner = new ShellRunner()) {}

  clone(repoUrl: string, destination: string, options: GitCloneOptions = {}): void {
    const depth = options.depth ?? SHALLOW_DEPTH;
    if (options.ref && COMMIT_SHA_PATTERN.test(options.ref)) {
      this.fetchShallowCommit(repoUrl, destination, options.ref, depth);
      return;
    }
    const args = ['clone', `--depth=${depth}`, ...(options.ref ? ['--branch', options.ref] : []), repoUrl, destination];
    this.runner.runOrThrow('git', args);
  }

  /** `git clone` cannot target a bare SHA — init + fetch the commit shallow, then check it out (ADR-0013). */
  private fetchShallowCommit(repoUrl: string, destination: string, sha: string, depth: number): void {
    this.runner.runOrThrow('git', ['init', destination]);
    this.runner.runOrThrow('git', ['-C', destination, 'remote', 'add', 'origin', repoUrl]);
    this.runner.runOrThrow('git', ['-C', destination, 'fetch', `--depth=${depth}`, 'origin', sha]);
    this.runner.runOrThrow('git', ['-C', destination, 'checkout', sha]);
  }

  revParseHead(repoDir: string): string {
    return this.runner.runOrThrow('git', ['-C', repoDir, 'rev-parse', 'HEAD']);
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
