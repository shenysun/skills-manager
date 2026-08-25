/**
 * What a click on a skill row means (ADR-0005 IA): the row name is the preview
 * entry, and the row body has no click behavior — until selection mode is
 * active, when clicking anywhere (the name included) toggles the checkbox.
 * The preview entry resumes the moment selection mode exits.
 */
export function rowNameClick(selectionActive: boolean): 'preview' | 'toggle' {
  return selectionActive ? 'toggle' : 'preview';
}

export function rowBodyClick(selectionActive: boolean): 'toggle' | null {
  return selectionActive ? 'toggle' : null;
}
