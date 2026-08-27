import { describe, expect, it } from 'vitest';
import { deriveRowStatus } from './rowStatus';
import type { DistributionTarget } from './distribution';

const projects = (...roots: string[]): DistributionTarget[] =>
  roots.map((targetRoot) => ({ kind: 'project', targetRoot, entries: [] }));

const row = (overrides: Partial<Parameters<typeof deriveRowStatus>[0]> = {}) => ({
  hasUpdate: false,
  warning: null,
  distributedAgents: [],
  distribution: [],
  ...overrides,
});

describe('deriveRowStatus (four single-page row states)', () => {
  it('warns first: a health warning outranks everything else', () => {
    expect(deriveRowStatus(row({ warning: 'Outdated copy: /x', hasUpdate: true, distributedAgents: ['zed'] }))).toEqual({
      kind: 'warning',
    });
  });

  it('marks an updatable skill when healthy', () => {
    expect(deriveRowStatus(row({ hasUpdate: true, distributedAgents: ['zed'] }))).toEqual({ kind: 'updatable' });
  });

  it('counts distributed agents and project targets when healthy and current', () => {
    expect(deriveRowStatus(row({ distributedAgents: ['claude-code', 'zed', 'warp'], distribution: projects('/a', '/b') }))).toEqual({
      kind: 'distributed',
      agentCount: 3,
      projectCount: 2,
    });
    expect(deriveRowStatus(row({ distributedAgents: ['warp'] }))).toEqual({
      kind: 'distributed',
      agentCount: 1,
      projectCount: 0,
    });
  });

  it('marks a skill with no observed agents as unlinked', () => {
    expect(deriveRowStatus(row())).toEqual({ kind: 'unlinked' });
  });
});
