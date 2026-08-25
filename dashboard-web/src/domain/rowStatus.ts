/**
 * Single-page row status (ADR-0005): one of four plain-text states per skill
 * row, in priority order — health warning first, then update availability,
 * then observed distribution, else unlinked. Display text is i18n's job;
 * this module only decides the state.
 */
export type RowStatus =
  | { kind: 'warning' }
  | { kind: 'updatable' }
  | { kind: 'distributed'; agentCount: number }
  | { kind: 'unlinked' };

export function deriveRowStatus(skill: {
  hasUpdate: boolean;
  warning: string | null;
  distributedAgents: readonly string[];
}): RowStatus {
  if (skill.warning !== null) return { kind: 'warning' };
  if (skill.hasUpdate) return { kind: 'updatable' };
  if (skill.distributedAgents.length > 0) return { kind: 'distributed', agentCount: skill.distributedAgents.length };
  return { kind: 'unlinked' };
}
