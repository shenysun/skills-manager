import { describe, expect, it } from 'vitest';
import {
  initialSelection,
  rememberApply,
  searchAgents,
  toggleAgent,
  toggleFamily,
  type PickerAgent,
} from './picker';

const agents: PickerAgent[] = [
  { id: 'claude-code', label: 'Claude Code', detected: true, familyKey: '/u/.claude/skills', invalidReason: null },
  { id: 'zed', label: 'Zed', detected: false, familyKey: '/u/.agents/skills', invalidReason: null },
  { id: 'warp', label: 'Warp', detected: false, familyKey: '/u/.agents/skills', invalidReason: null },
  { id: 'eve', label: 'Eve', detected: true, familyKey: null, invalidReason: 'Project-only agent' },
];

describe('initialSelection (first open vs remembered)', () => {
  it('first open with no memory checks the detected, selectable agents', () => {
    expect(initialSelection(agents, null)).toEqual(['claude-code']);
  });

  it('never checks an invalid agent, even when detected', () => {
    const selection = initialSelection(agents, null);
    expect(selection).not.toContain('eve');
  });

  it('a remembered apply is the selection, filtered to still-selectable ids', () => {
    expect(initialSelection(agents, ['warp', 'zed'])).toEqual(['warp', 'zed']);
    expect(initialSelection(agents, ['warp', 'gone-agent'])).toEqual(['warp']);
  });
});

describe('rememberApply (memory equals exactly the last confirmed apply)', () => {
  it('stores the applied ids per scope, leaving the other scope untouched', () => {
    const memory = rememberApply({}, 'user', ['zed', 'warp']);
    expect(memory).toEqual({ user: ['zed', 'warp'] });
    const withProject = rememberApply(memory, 'project', ['eve']);
    expect(withProject).toEqual({ user: ['zed', 'warp'], project: ['eve'] });
  });

  it('is immutable — the previous memory object is not mutated', () => {
    const memory = { user: ['zed'] };
    const next = rememberApply(memory, 'user', ['warp']);
    expect(memory).toEqual({ user: ['zed'] });
    expect(next.user).toEqual(['warp']);
  });

  it('cancel changes nothing: not calling rememberApply keeps the prior memory', () => {
    const memory = { user: ['zed'] };
    // Cancel path: the sheet is dismissed without confirm — no rememberApply call.
    expect(memory).toEqual({ user: ['zed'] });
  });
});

describe('toggleAgent / toggleFamily (selection unit is the agent id)', () => {
  it('adds and removes a single agent immutably', () => {
    expect(toggleAgent(['zed'], 'warp')).toEqual(['warp', 'zed']);
    expect(toggleAgent(['warp', 'zed'], 'warp')).toEqual(['zed']);
  });

  it('family select-all adds every selectable member, ignoring invalid ones', () => {
    expect(toggleFamily(agents, [], '/u/.agents/skills')).toEqual(['warp', 'zed']);
  });

  it('family select-all removes all members when the family is fully selected', () => {
    expect(toggleFamily(agents, ['warp', 'zed', 'claude-code'], '/u/.agents/skills')).toEqual(['claude-code']);
  });
});

describe('searchAgents', () => {
  it('matches id or label, case-insensitively', () => {
    expect(searchAgents(agents, 'claude').map((agent) => agent.id)).toEqual(['claude-code']);
    expect(searchAgents(agents, 'ZED').map((agent) => agent.id)).toEqual(['zed']);
  });

  it('keeps invalid agents visible in results (greyed, not hidden)', () => {
    expect(searchAgents(agents, 'eve').map((agent) => agent.id)).toEqual(['eve']);
  });
});
