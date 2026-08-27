/**
 * The hub distribution index grouped by target (physical layer, ADR-0004) —
 * the wire shape of /api/state's per-skill `distribution`. The preview Sheet
 * renders it as the 接入 reverse lookup; rows derive their project count.
 */

export type DistributionTarget = {
  kind: 'user' | 'project';
  targetRoot: string;
  entries: Array<{ runtimePath: string; agents: string[] }>;
};

export function projectRootsOf(distribution: readonly DistributionTarget[]): string[] {
  return distribution.filter((target) => target.kind === 'project').map((target) => target.targetRoot);
}

/** The shared `7 agents · 2 projects` label (visual baseline 2026-08-27):
 *  projects omitted at zero; one formatter so the row and the preview never
 *  drift apart. */
export function distCountsText(
  t: (key: string, n: number) => string,
  agentCount: number,
  projectCount: number,
): string {
  const agents = t('status.agents', agentCount);
  return projectCount > 0 ? `${agents} · ${t('status.projects', projectCount)}` : agents;
}
