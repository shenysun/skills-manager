import { SkillsManagerError } from '../../shared/errors.js';

/**
 * Parsed plugin entry of a `.claude-plugin/marketplace.json` manifest
 * (source-formats ticket 06). Form 1 — a string relative source plus a
 * non-empty `skills[]` — is the only consumable shape. External-repo forms
 * 2/3 (`git-subdir` / `url`) come back as `unsupported` so naming them fails
 * loudly instead of silently vanishing. Entries without a usable name or
 * `skills[]` are simply not consumable and drop out of the list.
 */
export type ParsedMarketplacePlugin =
  | { name: string; form: 'form1'; sourcePath: string; skillPaths: string[] }
  | { name: string; form: 'unsupported'; reason: 'git-subdir' | 'url' | 'external-source' };

/** Two-level presentation of a marketplace checkout (US-15/17): each plugin
 *  either lists its discovered skills or carries an unsupported reason. */
export type MarketplaceView = {
  plugins: Array<{
    name: string;
    skills: Array<{ name: string; subpath: string }>;
    unsupported?: 'git-subdir' | 'url' | 'external-source';
  }>;
};

export function parseMarketplacePlugins(manifestJson: string): ParsedMarketplacePlugin[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestJson);
  } catch {
    throw new SkillsManagerError('marketplace_manifest_invalid', 'The marketplace manifest (.claude-plugin/marketplace.json) is not valid JSON.');
  }
  const plugins = (manifest as { plugins?: unknown } | null)?.plugins;
  if (!Array.isArray(plugins)) {
    throw new SkillsManagerError('marketplace_manifest_invalid', 'The marketplace manifest has no plugins[] array — not a Claude Code marketplace manifest.');
  }
  const parsed: ParsedMarketplacePlugin[] = [];
  for (const entry of plugins) {
    const plugin = entry as { name?: unknown; source?: unknown; skills?: unknown };
    if (typeof plugin.name !== 'string' || !plugin.name.trim()) continue;
    const name = plugin.name.trim();
    const source = plugin.source;
    if (typeof source === 'string') {
      const skillPaths = plugin.skills;
      if (Array.isArray(skillPaths) && skillPaths.length > 0 && skillPaths.every((skillPath) => typeof skillPath === 'string' && skillPath.trim() !== '')) {
        parsed.push({ name, form: 'form1', sourcePath: source, skillPaths });
      }
      continue;
    }
    if (source !== null && typeof source === 'object') {
      const form = (source as { source?: unknown }).source;
      if (form === 'git-subdir') parsed.push({ name, form: 'unsupported', reason: 'git-subdir' });
      else if (form === 'url') parsed.push({ name, form: 'unsupported', reason: 'url' });
      else parsed.push({ name, form: 'unsupported', reason: 'external-source' });
    }
  }
  return parsed;
}
