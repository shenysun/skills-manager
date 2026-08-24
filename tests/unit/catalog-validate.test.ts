import { describe, expect, it } from 'vitest';
import { validateCatalogSnapshot } from '../../src/core/catalog/validate-snapshot.js';
import { SkillsManagerError } from '../../src/shared/errors.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

describe('validateCatalogSnapshot', () => {
  it('accepts a well-formed snapshot and returns it typed', () => {
    const snapshot = validateCatalogSnapshot(fixtureSnapshot());
    expect(snapshot.version).toBe(1);
    expect(snapshot.agents.map((agent) => agent.id)).toContain('claude-code');
  });

  it('rejects an unknown snapshot version with an actionable error', () => {
    const broken = { ...fixtureSnapshot(), version: 99 };
    expect(() => validateCatalogSnapshot(broken)).toThrowError(SkillsManagerError);
    expect(() => validateCatalogSnapshot(broken)).toThrow(/version/i);
    expect(() => validateCatalogSnapshot(broken)).toThrow(/catalog refresh/);
  });

  it('rejects duplicate agent ids', () => {
    const broken = fixtureSnapshot();
    broken.agents = [...broken.agents, { ...broken.agents[0] }];
    expect(() => validateCatalogSnapshot(broken)).toThrow(/duplicate/i);
    expect(() => validateCatalogSnapshot(broken)).toThrow(broken.agents[0].id);
  });

  it('rejects an agent whose skillsDir is not a relative path', () => {
    const broken = fixtureSnapshot();
    broken.agents = broken.agents.map((agent) => (agent.id === 'claude-code' ? { ...agent, skillsDir: '/abs/skills' } : agent));
    expect(() => validateCatalogSnapshot(broken)).toThrow(/skillsDir/i);
    expect(() => validateCatalogSnapshot(broken)).toThrow(/relative/i);
  });

  it('rejects an agent with an unsafe id', () => {
    const broken = fixtureSnapshot();
    broken.agents = broken.agents.map((agent) => (agent.id === 'claude-code' ? { ...agent, id: '../evil' } : agent));
    expect(() => validateCatalogSnapshot(broken)).toThrow(/id/i);
  });

  it('rejects an unknown detection condition kind', () => {
    const broken = fixtureSnapshot();
    broken.agents = broken.agents.map((agent) =>
      agent.id === 'claude-code' ? { ...agent, installProbe: { kind: 'totally-unknown' } } : agent,
    );
    expect(() => validateCatalogSnapshot(broken)).toThrow(/installProbe/i);
    expect(() => validateCatalogSnapshot(broken)).toThrow(/totally-unknown/);
  });

  it('rejects a missing source stamp', () => {
    const broken = fixtureSnapshot();
    broken.source = { ...broken.source, commit: '' };
    expect(() => validateCatalogSnapshot(broken)).toThrow(/commit/i);
  });
});
