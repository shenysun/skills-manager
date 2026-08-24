import { describe, expect, it } from 'vitest';
import { detectAgents, evaluateCondition } from '../../src/core/catalog/evaluate-detection.js';
import { fixtureSnapshot } from '../fixtures/catalog-snapshot.js';

function ctx(overrides: Partial<Parameters<typeof detectAgents>[1]> = {}) {
  return {
    variables: fixtureSnapshot().pathVariables,
    env: {} as Record<string, string | undefined>,
    homeDir: '/u/home',
    cwd: '/u/work/project',
    pathExists: (_path: string) => false,
    cwdPathExists: (_path: string) => false,
    packageHasDependency: (_name: string) => false,
    isTty: true,
    ...overrides,
  };
}

describe('evaluateCondition', () => {
  it('evaluates env-set and env-value leaves', () => {
    expect(evaluateCondition({ kind: 'env-set', variable: 'CLAUDECODE' }, ctx({ env: { CLAUDECODE: '1' } }))).toBe(true);
    expect(evaluateCondition({ kind: 'env-set', variable: 'CLAUDECODE' }, ctx())).toBe(false);
    expect(evaluateCondition({ kind: 'env-value', variable: 'CURSOR_EXTENSION_HOST_ROLE', equals: 'agent-exec' }, ctx({ env: { CURSOR_EXTENSION_HOST_ROLE: 'agent-exec' } }))).toBe(true);
    expect(evaluateCondition({ kind: 'env-value', variable: 'CURSOR_EXTENSION_HOST_ROLE', equals: 'agent-exec' }, ctx({ env: { CURSOR_EXTENSION_HOST_ROLE: 'other' } }))).toBe(false);
  });

  it('evaluates any / all combinators', () => {
    const any = { kind: 'any', conditions: [{ kind: 'env-set', variable: 'A' }, { kind: 'env-set', variable: 'B' }] } as const;
    const all = { kind: 'all', conditions: [{ kind: 'env-set', variable: 'A' }, { kind: 'env-set', variable: 'B' }] } as const;
    expect(evaluateCondition(any, ctx({ env: { B: '1' } }))).toBe(true);
    expect(evaluateCondition(any, ctx())).toBe(false);
    expect(evaluateCondition(all, ctx({ env: { A: '1', B: '1' } }))).toBe(true);
    expect(evaluateCondition(all, ctx({ env: { A: '1' } }))).toBe(false);
  });

  it('resolves path-exists templates through the variable table', () => {
    expect(evaluateCondition({ kind: 'path-exists', path: '$xdgConfig/opencode' }, ctx({ pathExists: (p) => p === '/u/home/.config/opencode' }))).toBe(true);
  });

  it('never matches the never leaf and unresolvable templates', () => {
    expect(evaluateCondition({ kind: 'never' }, ctx())).toBe(false);
    expect(evaluateCondition({ kind: 'path-exists', path: '$appData/Zed' }, ctx())).toBe(false);
  });
});

describe('detectAgents', () => {
  it('matches the `npx skills` no-flag target set: env probes plus installed probes, never more', () => {
    const result = detectAgents(fixtureSnapshot(), ctx({
      env: { CLAUDECODE: '1' },
      pathExists: (p) => p === '/u/home/.cursor' || p === '/u/home/.warp',
    }));
    // claude-code: env probe hit. cursor + warp: install probes hit.
    // zed (~/.agents not probed), codex, opencode, universal, eve: no probe hits.
    expect(result).toEqual(['claude-code', 'cursor', 'warp']);
  });

  it('includes cwd-based probes for project-only agents like eve', () => {
    const result = detectAgents(fixtureSnapshot(), ctx({
      cwdPathExists: (p) => p === 'agent',
      packageHasDependency: (name) => name === 'eve',
    }));
    expect(result).toEqual(['eve']);
  });

  it('returns a sorted, deduplicated id list', () => {
    const result = detectAgents(fixtureSnapshot(), ctx({
      env: { CLAUDECODE: '1', CODEX_CI: 'x', CURSOR_AGENT: 'y' },
      pathExists: () => true,
      cwdPathExists: () => true,
      packageHasDependency: () => true,
    }));
    expect(result).toEqual([...new Set(result)].sort());
    expect(result).toEqual(['claude-code', 'codex', 'cursor', 'eve', 'opencode', 'universal', 'warp', 'zed']);
  });

  it('excludes agents whose only probe is env-based when env is clean', () => {
    const result = detectAgents(fixtureSnapshot(), ctx());
    expect(result).toEqual([]);
  });
});
