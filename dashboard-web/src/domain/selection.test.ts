import { describe, expect, it } from 'vitest';
import { exitSelection, idleSelection, isSelected, selectionCount, toggleSelection } from './selection';

describe('selection state machine (enter / count / exit / no trace)', () => {
  it('is idle by default: not active, nobody selected', () => {
    expect(idleSelection).toEqual({ active: false, names: [] });
    expect(selectionCount(idleSelection)).toBe(0);
  });

  it('enters selection mode on the first check', () => {
    const state = toggleSelection(idleSelection, 'tdd');
    expect(state).toEqual({ active: true, names: ['tdd'] });
    expect(selectionCount(state)).toBe(1);
  });

  it('counts a multi-skill selection and stays sorted', () => {
    let state = toggleSelection(idleSelection, 'tdd');
    state = toggleSelection(state, 'grilling');
    state = toggleSelection(state, 'langfuse');
    expect(state.names).toEqual(['grilling', 'langfuse', 'tdd']);
    expect(selectionCount(state)).toBe(3);
    expect(isSelected(state, 'grilling')).toBe(true);
    expect(isSelected(state, 'nobody')).toBe(false);
  });

  it('unchecking one row keeps the mode; unchecking the last exits it', () => {
    let state = toggleSelection(idleSelection, 'tdd');
    state = toggleSelection(state, 'grilling');
    state = toggleSelection(state, 'tdd');
    expect(state).toEqual({ active: true, names: ['grilling'] });
    state = toggleSelection(state, 'grilling');
    expect(state).toEqual(idleSelection);
  });

  it('Esc/取消 exits leaving no trace — identical to a fresh idle state', () => {
    let state = toggleSelection(idleSelection, 'tdd');
    state = toggleSelection(state, 'grilling');
    expect(exitSelection(state)).toEqual(idleSelection);
  });

  it('toggles are immutable — the previous state object is untouched', () => {
    const before = { active: true, names: ['tdd'] };
    const after = toggleSelection(before, 'tdd');
    expect(before.names).toEqual(['tdd']);
    expect(after).toEqual(idleSelection);
  });
});
