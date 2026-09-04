import { describe, expect, it } from 'vitest';
import { addPrefer, movePrefer, preferOptions, removePrefer } from './initPrefer';

describe('preferOptions', () => {
  it('dedupes a shared runtime dir and lists every member agent', () => {
    expect(
      preferOptions([
        { agentId: 'zed', runtimeDir: '/agents' },
        { agentId: 'claude-code', runtimeDir: '/claude' },
        { agentId: 'warp', runtimeDir: '/agents' },
      ]),
    ).toEqual([
      { value: '/agents', agentIds: ['warp', 'zed'] },
      { value: '/claude', agentIds: ['claude-code'] },
    ]);
  });
});

describe('prefer list edits', () => {
  it('appends a new source, ignores duplicates, removes, and reorders', () => {
    expect(addPrefer([], 'hub')).toEqual(['hub']);
    expect(addPrefer(['hub'], 'hub')).toEqual(['hub']);
    expect(removePrefer(['a', 'hub'], 'a')).toEqual(['hub']);
    expect(movePrefer(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(movePrefer(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });
});
