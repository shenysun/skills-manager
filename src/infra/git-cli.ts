import type { GitLogEntry, GitPort } from '../core/ports/git.js';
import { ShellRunner } from './shell-runner.js';

export class GitCli implements GitPort {
  constructor(private readonly runner = new ShellRunner()) {}

  clone(repoUrl: string, destination: string): void {
    this.runner.runOrThrow('git', ['clone', repoUrl, destination]);
  }

  checkout(repoDir: string, ref: string): void {
    this.runner.runOrThrow('git', ['-C', repoDir, 'checkout', ref]);
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
