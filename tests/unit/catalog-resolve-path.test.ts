import { describe, expect, it } from 'vitest';
import { resolveCatalogTemplate } from '../../src/core/catalog/resolve-path.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

const variables = fixtureSnapshot().pathVariables;

describe('resolveCatalogTemplate', () => {
  it('expands ~ to the given home directory', () => {
    expect(resolveCatalogTemplate('~/.claude/skills', { variables, homeDir: '/u/home', env: {} })).toBe('/u/home/.claude/skills');
  });

  it('expands $variable with an env override', () => {
    expect(resolveCatalogTemplate('$codexHome/skills', { variables, homeDir: '/u/home', env: { CODEX_HOME: '/custom/codex' } })).toBe('/custom/codex/skills');
  });

  it('falls back to the variable default when the env var is unset', () => {
    expect(resolveCatalogTemplate('$codexHome', { variables, homeDir: '/u/home', env: {} })).toBe('/u/home/.codex');
  });

  it('expands a default that itself contains ~', () => {
    expect(resolveCatalogTemplate('$xdgConfig/opencode', { variables, homeDir: '/u/home', env: {} })).toBe('/u/home/.config/opencode');
  });

  it('returns null for a variable with no default and no env value', () => {
    const optional = [...variables, { name: 'appData', envVar: 'APPDATA' }];
    expect(resolveCatalogTemplate('$appData/Zed', { variables: optional, homeDir: '/u/home', env: {} })).toBeNull();
  });

  it('returns null for an unknown variable rather than guessing', () => {
    expect(resolveCatalogTemplate('$unknownHome/skills', { variables, homeDir: '/u/home', env: {} })).toBeNull();
  });

  it('keeps absolute literal paths as-is', () => {
    expect(resolveCatalogTemplate('/etc/codex', { variables, homeDir: '/u/home', env: {} })).toBe('/etc/codex');
  });
});
