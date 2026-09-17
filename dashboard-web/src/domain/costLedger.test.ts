import { describe, expect, it } from 'vitest';
import { footprintOf, formatApproxTokens, showCostLine, type CostLedger } from './costLedger';

/** The ledger wire shape GET /api/cost returns — enough of it for the UI seams. */
function ledger(paths: CostLedger['paths']): CostLedger {
  return {
    method: 'char-approx',
    totalTokens: paths.reduce((total, group) => total + group.tokens, 0),
    unmanaged: 0,
    paths,
    suggestions: { archived: [], topDescriptions: [], scattered: [] },
    errors: [],
  };
}

describe('formatApproxTokens', () => {
  it('never prefixes a plain number with ≈ below 1k', () => {
    expect(formatApproxTokens(0)).toBe('≈0');
    expect(formatApproxTokens(180)).toBe('≈180');
    expect(formatApproxTokens(999)).toBe('≈999');
  });

  it('abbreviates thousands with one decimal, dropping a trailing .0', () => {
    expect(formatApproxTokens(1000)).toBe('≈1k');
    expect(formatApproxTokens(1234)).toBe('≈1.2k');
    expect(formatApproxTokens(7300)).toBe('≈7.3k');
    expect(formatApproxTokens(99400)).toBe('≈99.4k');
  });

  it('rounds six-figure counts to whole k', () => {
    expect(formatApproxTokens(100000)).toBe('≈100k');
    expect(formatApproxTokens(123456)).toBe('≈123k');
  });
});

describe('showCostLine', () => {
  it('hides until the ledger loads', () => {
    expect(showCostLine(null)).toBe(false);
  });

  it('hides when nothing is distributed — zero residency needs no line', () => {
    expect(showCostLine(ledger([]))).toBe(false);
  });

  it('shows once any physical path carries a distribution', () => {
    expect(
      showCostLine(
        ledger([{ runtimeDir: '/agents/claude/skills', kind: 'user', agents: ['claude-code'], tokens: 42, skills: [{ skill: 'x', tokens: 42, nameTokens: 1, descriptionTokens: 41 }] }]),
      ),
    ).toBe(true);
  });
});

describe('footprintOf', () => {
  const hub = ledger([
    {
      runtimeDir: '/agents/claude/skills',
      kind: 'user',
      agents: ['claude-code'],
      tokens: 300,
      skills: [
        { skill: 'team', tokens: 300, nameTokens: 4, descriptionTokens: 296 },
        { skill: 'nodesc', tokens: 4, nameTokens: 4, descriptionTokens: 0, incomplete: true },
      ],
    },
    { runtimeDir: '/proj/.claude/skills', kind: 'project', agents: ['claude-code'], tokens: 180, skills: [{ skill: 'team', tokens: 180, nameTokens: 4, descriptionTokens: 176 }] },
  ]);

  it('finds the skill on the path group the runtime entry lives in', () => {
    expect(footprintOf(hub, 'team', '/proj/.claude/skills/team')).toBe(180);
    expect(footprintOf(hub, 'team', '/agents/claude/skills/team')).toBe(300);
  });

  it('still reports incomplete (name-only) lines — they are counted, not defects', () => {
    expect(footprintOf(hub, 'nodesc', '/agents/claude/skills/nodesc')).toBe(4);
  });

  it('returns null before the ledger loads and for unknown skills or paths', () => {
    expect(footprintOf(null, 'team', '/agents/claude/skills/team')).toBeNull();
    expect(footprintOf(hub, 'ghost', '/agents/claude/skills/ghost')).toBeNull();
    expect(footprintOf(hub, 'team', '/elsewhere/skills/team')).toBeNull();
  });
});
