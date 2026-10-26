import type { SyncStatusResult } from '../core/services/sync-service.js';

/**
 * Privacy-safe paste card for `skills-manager sync status --share` (growth
 * wedge): multi-machine hub posture without absolute hub paths or remote URLs.
 * Labels only — gitified?, remote yes/no, dirty count, ahead/behind, last
 * commit subject — plus a Try/Reproduce CTA and the repo URL.
 */
export function renderSyncShare(result: SyncStatusResult): string {
  const lines: string[] = [];
  lines.push('Hub sync posture · skills-manager');
  if (!result.gitified) {
    lines.push('git: no — run sync init --remote <url>');
  } else {
    const remote = result.remote === null ? 'no' : 'yes';
    const dirty = `dirty: ${result.dirtyFiles}`;
    const ab = result.aheadBehind === null
      ? 'ahead/behind: unknown'
      : `ahead ${result.aheadBehind.ahead} / behind ${result.aheadBehind.behind}`;
    lines.push(`git: yes · remote: ${remote} · ${dirty} · ${ab}`);
    if (result.lastCommit === null) {
      lines.push('last: none yet');
    } else {
      lines.push(`last: ${result.lastCommit.message}`);
    }
  }
  lines.push('Try/Reproduce: skills-manager sync status --share');
  lines.push('https://github.com/shenysun/skills-manager');
  return `${lines.join('\n')}\n`;
}
