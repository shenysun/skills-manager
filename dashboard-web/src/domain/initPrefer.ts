/** Per-import conflict priority (ADR-0009): ordered sources, identity is the runtime dir (or `hub`). */

export type ScannedAgent = { agentId: string; runtimeDir: string };

export type PreferOption = {
  value: string;
  agentIds: string[];
};

export function preferOptions(scanned: readonly ScannedAgent[]): PreferOption[] {
  const byDir = new Map<string, string[]>();
  for (const row of scanned) {
    const ids = byDir.get(row.runtimeDir) ?? [];
    byDir.set(row.runtimeDir, ids.includes(row.agentId) ? ids : [...ids, row.agentId]);
  }
  return [...byDir.entries()].map(([value, agentIds]) => ({ value, agentIds: [...agentIds].sort() }));
}

export function addPrefer(list: readonly string[], value: string): string[] {
  if (!value || list.includes(value)) return [...list];
  return [...list, value];
}

export function removePrefer(list: readonly string[], value: string): string[] {
  return list.filter((item) => item !== value);
}

export function movePrefer(list: readonly string[], index: number, delta: number): string[] {
  const target = index + delta;
  if (index < 0 || target < 0 || target >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}
