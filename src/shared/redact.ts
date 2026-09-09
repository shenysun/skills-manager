import type { DiscoveredSkill, SourceCheckout } from '../core/model/index.js';

/**
 * Presentation-shaped copies that drop filesystem internals (temp clone paths,
 * absolute machine paths) from values crossing into CLI/dashboard output.
 * Internal callers keep the full objects — these are for the conversation
 * layer only (ticket manager-skill-first/02).
 */
export function redactCheckout(checkout: SourceCheckout): Omit<SourceCheckout, 'repoDir' | 'treeRest'> {
  const { repoDir: _repoDir, treeRest: _treeRest, ...publicShape } = checkout;
  return publicShape;
}

export function redactDiscovered(skill: DiscoveredSkill): Omit<DiscoveredSkill, 'absoluteDir'> {
  const { absoluteDir: _absoluteDir, ...publicShape } = skill;
  return publicShape;
}
