/**
 * Any-agent picker semantics (ADR-0004 §7): the selection unit is always a
 * catalog agent id; family select-all is pure UI sugar; memory is per scope
 * and equals exactly the last confirmed apply — cancel never writes it.
 */
export type Scope = 'user' | 'project';

export type PickerAgent = {
  id: string;
  label: string;
  detected: boolean;
  familyKey: string | null;
  invalidReason: string | null;
};

export type PickerMemory = Partial<Record<Scope, string[]>>;

const selectable = (agents: readonly PickerAgent[]) => agents.filter((agent) => agent.invalidReason === null);
const sorted = (ids: readonly string[]) => [...ids].sort();

export function selectableAgents(agents: readonly PickerAgent[]) {
  return selectable(agents);
}

/** First open (no memory): the detected, selectable agents. With memory: the remembered apply, filtered to what is still selectable. */
export function initialSelection(agents: readonly PickerAgent[], remembered: readonly string[] | null): string[] {
  const valid = new Set(selectable(agents).map((agent) => agent.id));
  if (remembered !== null) return sorted(remembered.filter((id) => valid.has(id)));
  return selectable(agents).filter((agent) => agent.detected).map((agent) => agent.id);
}

export function toggleAgent(selected: readonly string[], id: string): string[] {
  return sorted(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
}

/** Family select-all sugar over agent-id selection; invalid members never join. */
export function toggleFamily(agents: readonly PickerAgent[], selected: readonly string[], familyKey: string): string[] {
  const members = selectable(agents).filter((agent) => agent.familyKey === familyKey).map((agent) => agent.id);
  const fullySelected = members.length > 0 && members.every((id) => selected.includes(id));
  const next = new Set(selected);
  for (const id of members) {
    if (fullySelected) next.delete(id);
    else next.add(id);
  }
  return sorted(next);
}

/** Memory write happens only on confirm — this is the single mutation point. */
export function rememberApply(memory: PickerMemory, scope: Scope, applied: readonly string[]): PickerMemory {
  return { ...memory, [scope]: [...applied] };
}

export function searchAgents(agents: readonly PickerAgent[], query: string): PickerAgent[] {
  const term = query.trim().toLowerCase();
  if (term === '') return [...agents];
  return agents.filter((agent) => agent.id.toLowerCase().includes(term) || agent.label.toLowerCase().includes(term));
}
