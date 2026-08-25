import { describe, expect, it } from 'vitest';
import { idleSelection, toggleSelection } from './selection';
import { rowBodyClick, rowNameClick } from './rowClick';

/** The page-level selection state feeds these decisions; only `active` matters. */
function activeOf(state: { active: boolean }) {
  return state.active;
}

describe('row click semantics under selection mode (ADR-0005 IA)', () => {
  it('outside selection mode the row name opens the preview; the row body does nothing', () => {
    expect(rowNameClick(activeOf(idleSelection))).toBe('preview');
    expect(rowBodyClick(activeOf(idleSelection))).toBeNull();
  });

  it('inside selection mode every click — name included — toggles the checkbox', () => {
    const selecting = toggleSelection(idleSelection, 'tdd');
    expect(rowNameClick(activeOf(selecting))).toBe('toggle');
    expect(rowBodyClick(activeOf(selecting))).toBe('toggle');
  });

  it('the preview entry resumes once selection mode exits', () => {
    let state = toggleSelection(idleSelection, 'tdd');
    state = toggleSelection(state, 'tdd'); // uncheck the last row → mode exits
    expect(rowNameClick(activeOf(state))).toBe('preview');
  });
});
