/**
 * Add-wizard marketplace grouping (source-formats ticket 08, US-15/17): the
 * pick step renders one group per manifest plugin — its skills as selectable
 * rows, an unsupported reason where the plugin cannot be consumed. Pure
 * derivation and selection math; the component only binds.
 */
import type { DiscoveredSkill, MarketplacePlugin } from '../api/client';

export type PluginGroup = MarketplacePlugin & {
  /** The discovered rows of this plugin, in the plugin's own order. */
  rows: DiscoveredSkill[];
  /** The rows' subpaths — the group select-all's selection unit. */
  subpaths: string[];
};

export function pluginGroups(plugins: readonly MarketplacePlugin[] | null, discovered: readonly DiscoveredSkill[]): PluginGroup[] | null {
  if (plugins === null) return null;
  return plugins.map((plugin) => ({
    ...plugin,
    rows: plugin.skills
      .map((skill) => discovered.find((candidate) => candidate.subpath === skill.subpath))
      .filter((skill): skill is DiscoveredSkill => skill !== undefined),
    subpaths: plugin.skills.map((skill) => skill.subpath),
  }));
}

export function groupFullySelected(selected: readonly string[], subpaths: readonly string[]): boolean {
  return subpaths.length > 0 && subpaths.every((subpath) => selected.includes(subpath));
}

export function toggleGroup(selected: readonly string[], subpaths: readonly string[]): string[] {
  if (groupFullySelected(selected, subpaths)) {
    return selected.filter((entry) => !subpaths.includes(entry));
  }
  return [...new Set([...selected, ...subpaths])];
}

/** i18n key for why a manifest plugin cannot be consumed (US-17). */
export function unsupportedReasonKey(reason: NonNullable<MarketplacePlugin['unsupported']>): string {
  switch (reason) {
    case 'git-subdir': return 'add.reasonGitSubdir';
    case 'url': return 'add.reasonUrl';
    case 'external-source': return 'add.reasonExternal';
  }
}
