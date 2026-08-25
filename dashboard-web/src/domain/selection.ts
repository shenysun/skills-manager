/**
 * Selection mode is a body-level mode with zero persistence: the first check
 * enters it, unchecking the last row (or Esc/取消) exits it leaving no trace.
 */
export type SelectionState = { active: boolean; names: readonly string[] };

export const idleSelection: SelectionState = { active: false, names: [] };

export function toggleSelection(state: SelectionState, name: string): SelectionState {
  const names = state.names.includes(name)
    ? state.names.filter((item) => item !== name)
    : [...state.names, name].sort();
  return names.length > 0 ? { active: true, names } : idleSelection;
}

/** Esc and 取消 share this path: clear and exit, weightless. */
export function exitSelection(_state: SelectionState): SelectionState {
  return idleSelection;
}

export function selectionCount(state: SelectionState): number {
  return state.names.length;
}

export function isSelected(state: SelectionState, name: string): boolean {
  return state.names.includes(name);
}
