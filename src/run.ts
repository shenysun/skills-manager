import { spawnSync } from 'node:child_process';
import { SKILL_HOME } from './paths.js';

export function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const result = spawnSync(cmd, args, {
    cwd: opts.cwd || SKILL_HOME,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    const detail = opts.quiet ? `\n${result.stderr || result.stdout || ''}` : '';
    throw new Error(`命令执行失败：${cmd} ${args.join(' ')}${detail}`);
  }
  return (result.stdout || '').trim();
}
