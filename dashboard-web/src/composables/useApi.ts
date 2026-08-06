import { ref } from 'vue';

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;
export type Skill = { name: string; path: string; title: string; category: string; tags: string[]; consumers: string[]; description: string; source: { url?: string | null; subpath?: string | null; ref?: string | null; upstream_commit?: string | null }; files?: string[] };
export type UpdateCandidate = { skill: string; url: string; subpath: string; ref?: string; title: string; description: string; consumers: string[] };
export type SourceGroup = { key: string; url: string; ref?: string; skills: UpdateCandidate[]; installedSkills?: string[] };
export type Doctor = { skillHome: string; skillCount: number; viewLinks: Record<string, number>; brokenLinks: string[]; warnings: string[]; gitStatus: string };
export type ActivityRecord = { id?: string; timestamp: string; action?: string; summary?: string; subject?: string; hash?: string; details?: unknown };
export type DashboardState = { skillHome: string; skills: Skill[]; candidates: UpdateCandidate[]; sources: SourceGroup[]; doctor: Doctor; registry: { skills: Record<string, unknown> }; activity: ActivityRecord[]; gitHistory: ActivityRecord[]; package: { ok: boolean; warnings: string[]; info: Record<string, unknown> }; counts: Record<string, number> };

export const state = ref<DashboardState | null>(null);
export const logText = ref('Ready.');

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!payload) throw new Error(res.statusText);
  if (!payload.ok) throw new Error(payload.error.message);
  return payload.data;
}

export async function refreshState() {
  state.value = await api<DashboardState>('/api/state');
  return state.value;
}

export async function runApi<T>(fn: () => Promise<T>) {
  try {
    const result = await fn();
    logText.value = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    await refreshState();
    return result;
  } catch (error) {
    logText.value = error instanceof Error ? error.message : String(error);
    throw error;
  }
}
