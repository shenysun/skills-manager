import { describe, expect, it } from 'vitest';
import {
  clearVisible,
  defaultProjectRoot,
  groupFamilies,
  initialSelection,
  rememberApply,
  searchAgents,
  selectAllVisible,
  selectDetectedVisible,
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

/* Two true families ("/u/.agents/skills" ×3), two singleton families
   ("/u/.claude/skills", "/u/.amp/skills"), one family-less invalid agent. */
const quickCatalog: PickerAgent[] = [
  { id: 'claude-code', label: 'Claude Code', detected: true, familyKey: '/u/.claude/skills', invalidReason: null },
  { id: 'cursor', label: 'Cursor', detected: true, familyKey: '/u/.agents/skills', invalidReason: null },
  { id: 'zed', label: 'Zed', detected: false, familyKey: '/u/.agents/skills', invalidReason: null },
  { id: 'warp', label: 'Warp', detected: false, familyKey: '/u/.agents/skills', invalidReason: null },
  { id: 'amp', label: 'Amp', detected: false, familyKey: '/u/.amp/skills', invalidReason: null },
  { id: 'eve', label: 'Eve', detected: true, familyKey: null, invalidReason: 'Project-only agent' },
];

describe('quick actions (select-all / select-detected / clear act on the visible set)', () => {
  it('select-all with no query checks every selectable agent, unioned with what is already picked', () => {
    expect(selectAllVisible(quickCatalog, '', ['amp', 'zed'])).toEqual([
      'amp',
      'claude-code',
      'cursor',
      'warp',
      'zed',
    ]);
  });

  it('select-all with a query adds only matching rows — off-screen ticks are untouched', () => {
    expect(selectAllVisible(quickCatalog, 'warp', ['claude-code'])).toEqual(['claude-code', 'warp']);
  });

  it('never admits an invalid agent, even when the query matches it', () => {
    expect(selectAllVisible(quickCatalog, 'eve', ['zed'])).toEqual(['zed']);
  });

  it('select-detected with no query checks exactly the selectable ∩ detected slice', () => {
    expect(selectDetectedVisible(quickCatalog, '', [])).toEqual(['claude-code', 'cursor']);
  });

  it('select-detected with a query adds only visible detected agents; an undetected match changes nothing', () => {
    expect(selectDetectedVisible(quickCatalog, 'cursor', ['zed'])).toEqual(['cursor', 'zed']);
    expect(selectDetectedVisible(quickCatalog, 'warp', ['warp'])).toEqual(['warp']);
  });

  it('clear with no query empties the whole selection', () => {
    expect(clearVisible(quickCatalog, '', ['claude-code', 'zed'])).toEqual([]);
  });

  it('clear with a query unchecks only visible rows — off-screen ticks survive the clear', () => {
    expect(clearVisible(quickCatalog, 'zed', ['claude-code', 'zed', 'amp'])).toEqual(['amp', 'claude-code']);
  });
});

describe('defaultProjectRoot (project scope pre-fill)', () => {
  it('prefills the most recently distributed project', () => {
    expect(defaultProjectRoot(['/p/recent', '/p/older'])).toBe('/p/recent');
  });

  it('stays empty with no distribution history — never a server cwd guess', () => {
    expect(defaultProjectRoot([])).toBe('');
  });
});

describe('groupFamilies (a family header exists only where a real family is)', () => {
  it('groups only familyKeys holding ≥2 selectable members, in catalogue order', () => {
    const { families } = groupFamilies(quickCatalog);
    expect(families).toEqual([
      {
        familyKey: '/u/.agents/skills',
        members: [quickCatalog[1], quickCatalog[2], quickCatalog[3]],
      },
    ]);
  });

  it('flattens single-member families (and family-less agents) into plain singleton rows', () => {
    const { singletons } = groupFamilies(quickCatalog);
    expect(singletons.map((agent) => agent.id)).toEqual(['claude-code', 'amp']);
  });

  it('covers exactly the selectable agents — invalid ones belong to neither output', () => {
    const { families, singletons } = groupFamilies(quickCatalog);
    const ids = [...families.flatMap((family) => family.members), ...singletons].map((agent) => agent.id).sort();
    expect(ids).toEqual(['amp', 'claude-code', 'cursor', 'warp', 'zed']);
  });
});
