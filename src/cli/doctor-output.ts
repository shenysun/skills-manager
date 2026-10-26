import { formatApproxTokens } from '../core/services/cost-ledger-service.js';
import type { DoctorReport } from '../core/model/index.js';

/**
 * Privacy-safe paste card for `skills-manager doctor --share` (growth wedge):
 * counts and magnitudes only — never skillHome, broken-link paths, skill names,
 * or warning text that may embed absolute paths. Try/Reproduce CTA + repo URL.
 */
export function renderDoctorShare(report: DoctorReport): string {
  const cost = report.residentCost;
  const dist = report.distribution;
  const lines: string[] = [];
  lines.push('Hub health · skills-manager');
  lines.push(
    `${report.skillCount} skill(s) · managed ${dist.managedEntries} · outdated ${dist.outdated} · foreign ${dist.foreign}`,
  );
  lines.push(`Resident: ${formatApproxTokens(cost.totalTokens)} tokens / message · ${cost.method}`);
  const scattered = cost.suggestions.scattered.length;
  if (scattered > 0) lines.push(`Watch: ${scattered} scattered`);
  lines.push(
    `Security: ${report.security.high} high · ${report.security.scanner} · scanned ${report.security.scanned}`,
  );
  lines.push(report.warnings.length === 0 ? 'Warnings: none' : `Warnings: ${report.warnings.length}`);
  if (report.brokenLinks.length > 0) lines.push(`Broken links: ${report.brokenLinks.length}`);
  if (report.importedWithoutSource.length > 0) {
    lines.push(`Imported without source: ${report.importedWithoutSource.length}`);
  }
  lines.push('Try: npx skills-manager-cli');
  lines.push('Reproduce: skills-manager doctor --share');
  lines.push('https://github.com/shenysun/skills-manager');
  return `${lines.join('\n')}\n`;
}
