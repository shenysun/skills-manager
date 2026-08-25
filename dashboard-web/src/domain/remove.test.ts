import { describe, expect, it } from 'vitest';
import { removeConsequence } from './remove';

describe('removeConsequence (operator-terms confirm copy)', () => {
  it('counts skills and total observed agent entries to undistribute', () => {
    expect(removeConsequence([{ distributedAgents: ['zed', 'warp', 'claude-code'] }])).toEqual({ skillCount: 1, agentCount: 3 });
    expect(
      removeConsequence([
        { distributedAgents: ['zed', 'warp'] },
        { distributedAgents: [] },
      ]),
    ).toEqual({ skillCount: 2, agentCount: 2 });
  });

  it('handles an empty selection', () => {
    expect(removeConsequence([])).toEqual({ skillCount: 0, agentCount: 0 });
  });
});
