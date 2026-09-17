import { formatApproxTokens, type CostLedger, type ScopedPathCost } from '../core/services/cost-ledger-service.js';

/**
 * Human rendering for `skills-manager cost` (spec context-cost, Q10 shape):
 * path groups → per-skill lines → total + unmanaged line → the three
 * suggestion layers. English per repo CLI convention; every number rides
 * formatApproxTokens; every suggestion shows its verbatim command and nothing
 * is ever executed.
 */
export function renderCostLedger(ledger: CostLedger): string {
  const lines: string[] = [];
  lines.push(`Resident context cost (${ledger.method}) — total ${formatApproxTokens(ledger.totalTokens)} tokens across ${ledger.paths.length} runtime path(s)`);
  for (const group of ledger.paths) {
    lines.push('');
    const family = group.agents.length > 0 ? group.agents.join(', ') : 'none';
    lines.push(`${group.runtimeDir} (${group.kind}, agents: ${family}) — ${formatApproxTokens(group.tokens)}`);
    const width = Math.max(0, ...group.skills.map((line) => line.skill.length));
    for (const line of group.skills) {
      const marks = [line.archived ? '(archived)' : null, line.incomplete ? 'incomplete' : null].filter(Boolean).join(' ');
      lines.push(`  ${line.skill.padEnd(width)}  ${formatApproxTokens(line.tokens)}${marks ? `  ${marks}` : ''}`);
    }
  }
  lines.push('');
  lines.push(`${ledger.unmanaged} unmanaged skill(s) not counted`);
  if (ledger.errors.length > 0) {
    lines.push('Errors (counted as 0):');
    for (const error of ledger.errors) lines.push(`  ${error.skill} — ${error.runtimePath}: ${error.reason}`);
  }

  const suggestions = ledger.suggestions;
  const empty = suggestions.archived.length === 0 && suggestions.topDescriptions.length === 0 && suggestions.scattered.length === 0;
  lines.push('');
  lines.push('Suggestions (report-only — nothing is executed):');
  if (empty) {
    lines.push('  none');
    return `${lines.join('\n')}\n`;
  }
  if (suggestions.archived.length > 0) {
    lines.push('Zero-controversy recalls (archived but still distributed):');
    for (const item of suggestions.archived) {
      lines.push(`  ${item.skill} (archived) ${formatApproxTokens(item.tokens)} — ${item.runtimeDir}`);
      lines.push(`    ${item.command}`);
    }
  }
  if (suggestions.topDescriptions.length > 0) {
    const count = suggestions.topDescriptions.length;
    lines.push(`Top ${count} most expensive description${count === 1 ? '' : 's'}:`);
    for (const item of suggestions.topDescriptions) {
      lines.push(`  ${item.skill} ${formatApproxTokens(item.tokens)} — ${item.runtimeDir}`);
      lines.push(`    ${item.command}`);
    }
  }
  if (suggestions.scattered.length > 0) {
    lines.push('Scattered distributions (same skill on several paths — consolidate by recalling all but one):');
    for (const item of suggestions.scattered) {
      lines.push(`  ${item.skill} on ${item.runtimeDirs.length} paths: ${item.runtimeDirs.join(', ')}`);
      for (const command of item.commands) lines.push(`    ${command}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The one-line resident-cost tail of a `preset apply` success (ADR-0019
 *  US20): ≈-prefixed char-approx tokens, the same magnitude convention as the
 *  ledger above. */
export function renderPresetCostLine(cost: ScopedPathCost): string {
  return `Resident cost: ${formatApproxTokens(cost.tokens)} tokens per message (${cost.method})`;
}
