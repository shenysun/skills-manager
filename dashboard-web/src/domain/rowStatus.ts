/**
 * Single-page row status (ADR-0005): one plain-text state per skill row, in
 * priority order — health warning first, then detection failure (a failed
 * detection makes the update verdict unknowable, so it outranks every
 * not-updated state), then update availability, then observed distribution,
 * else unlinked. Display text is i18n's job; this module only decides the state.
 */
import { projectRootsOf, type DistributionTarget } from './distribution';

export type RowStatus =
  | { kind: 'warning' }
  | { kind: 'detectionFailed' }
  | { kind: 'updatable' }
  | { kind: 'distributed'; agentCount: number; projectCount: number }
  | { kind: 'unlinked' };

export function deriveRowStatus(skill: {
  hasUpdate: boolean;
  detection: 'ok' | 'failed' | 'skipped';
  warning: string | null;
  distributedAgents: readonly string[];
  distribution: readonly DistributionTarget[];
}): RowStatus {
  if (skill.warning !== null) return { kind: 'warning' };
  if (skill.detection === 'failed') return { kind: 'detectionFailed' };
  if (skill.hasUpdate) return { kind: 'updatable' };
  if (skill.distributedAgents.length > 0) {
    return { kind: 'distributed', agentCount: skill.distributedAgents.length, projectCount: projectRootsOf(skill.distribution).length };
  }
  return { kind: 'unlinked' };
}
