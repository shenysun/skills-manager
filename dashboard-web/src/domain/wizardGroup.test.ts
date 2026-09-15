import { describe, expect, it } from 'vitest';
import { groupFullySelected, pluginGroups, toggleGroup } from './wizardGroup';
import type { DiscoveredSkill, MarketplacePlugin } from '../api/client';

const alpha: DiscoveredSkill = { name: 'alpha', title: 'alpha', description: 'a', subpath: 'plugins/core/skills/alpha', plugin: 'core' };
const beta: DiscoveredSkill = { name: 'beta', title: 'beta', description: 'b', subpath: 'plugins/core/skills/beta', plugin: 'core' };

describe('pluginGroups', () => {
  it('returns null for a non-marketplace source', () => {
    expect(pluginGroups(null, [alpha])).toBeNull();
  });

  it('pairs each manifest plugin with its discovered rows', () => {
    const plugins: MarketplacePlugin[] = [
      { name: 'core', skills: [{ name: 'alpha', subpath: alpha.subpath }, { name: 'beta', subpath: beta.subpath }] },
      { name: 'linked', skills: [], unsupported: 'git-subdir' },
    ];
    const groups = pluginGroups(plugins, [alpha, beta]);
    expect(groups).toEqual([
      { name: 'core', skills: plugins[0].skills, rows: [alpha, beta], subpaths: [alpha.subpath, beta.subpath] },
      { name: 'linked', skills: [], unsupported: 'git-subdir', rows: [], subpaths: [] },
    ]);
  });
});

describe('group selection', () => {
  const subpaths = ['plugins/core/skills/alpha', 'plugins/core/skills/beta'];

  it('is fully selected only when every member is selected', () => {
    expect(groupFullySelected(subpaths, subpaths)).toBe(true);
    expect(groupFullySelected(['plugins/core/skills/alpha'], subpaths)).toBe(false);
    expect(groupFullySelected([], subpaths)).toBe(false);
  });

  it('selecting a group adds every member once', () => {
    expect(toggleGroup(['unrelated'], subpaths)).toEqual(['unrelated', ...subpaths]);
    expect(toggleGroup(['plugins/core/skills/alpha'], subpaths)).toEqual(subpaths);
  });

  it('selecting a fully selected group clears exactly that group', () => {
    expect(toggleGroup([...subpaths, 'other'], subpaths)).toEqual(['other']);
  });
});
