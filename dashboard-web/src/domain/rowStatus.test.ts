import { describe, expect, it } from 'vitest';
import { deriveRowStatus } from './rowStatus';

const row = (overrides: Partial<Parameters<typeof deriveRowStatus>[0]> = {}) => ({
  hasUpdate: false,
  warning: null,
  distributedAgents: [],
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

  it('counts distributed agents when healthy and current', () => {
    expect(deriveRowStatus(row({ distributedAgents: ['claude-code', 'zed', 'warp'] }))).toEqual({
      kind: 'distributed',
      agentCount: 3,
    });
  });

  it('marks a skill with no observed agents as unlinked', () => {
    expect(deriveRowStatus(row())).toEqual({ kind: 'unlinked' });
  });
});
