import { computed, ref } from 'vue';

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string; details?: unknown } };
export type ApiResponse<T> = ApiOk<T> | ApiErr;
export type Skill = { name: string; path: string; title: string; category: string; tags: string[]; consumers: string[]; description: string; source: { url?: string | null; subpath?: string | null; ref?: string | null; upstream_commit?: string | null }; files?: string[] };
export type UpdateCandidate = { skill: string; url: string; subpath: string; ref?: string; title: string; description: string; consumers: string[] };
export type SourceGroup = { key: string; url: string; ref?: string; skills: UpdateCandidate[]; installedSkills?: string[] };
export type Doctor = {
  skillHome: string;
  skillCount: number;
  distribution: { agents: number; claude: number; outdated: number; foreign: number; leftoverViews: boolean };
  brokenLinks: string[];
  warnings: string[];
  gitStatus: string;
};
export type ActivityRecord = { id?: string; timestamp: string; action?: string; summary?: string; subject?: string; hash?: string; details?: unknown };
export type RegistrySkillEntry = {
  title?: string;
  category?: string;
  tags?: string[];
  consumers?: string[];
  description?: string;
  source?: {
    url?: string | null;
    subpath?: string | null;
    ref?: string | null;
    upstream_commit?: string | null;
  };
};
export type DashboardState = {
  skillHome: string;
  skills: Skill[];
  candidates: UpdateCandidate[];
  sources: SourceGroup[];
  doctor: Doctor;
  registry: { skills: Record<string, RegistrySkillEntry> };
  activity: ActivityRecord[];
  gitHistory: ActivityRecord[];
  package: { ok: boolean; warnings: string[]; info: Record<string, unknown> };
  counts: Record<string, number>;
};

export const state = ref<DashboardState | null>(null);
export const logText = ref('');

type ActiveOperation = { id: number; label?: string; startedAt: number };
type OperationOptions = { label?: string };
let nextOperationId = 1;

export const activeOperations = ref<ActiveOperation[]>([]);
export const isBusy = computed(() => activeOperations.value.length > 0);
export const currentOperation = computed(() => activeOperations.value.at(-1) || null);
export const currentOperationLabel = computed(() => currentOperation.value?.label || '');

function startOperation(options?: OperationOptions) {
  if (!options?.label) return null;
  const operation = { id: nextOperationId++, label: options.label, startedAt: Date.now() };
  activeOperations.value = [...activeOperations.value, operation];
  return operation.id;
}

function finishOperation(operationId: number | null) {
  if (operationId === null) return;
  activeOperations.value = activeOperations.value.filter((operation) => operation.id !== operationId);
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  const payload = (await res.json().catch(() => null)) as ApiResponse<T> | null;
  if (!payload) throw new Error(res.statusText);
  if (!payload.ok) throw new Error(payload.error.message);
  return payload.data;
}

export async function refreshState(options?: OperationOptions) {
  const operationId = startOperation(options);
  try {
    state.value = await api<DashboardState>('/api/state');
    return state.value;
  } finally {
    finishOperation(operationId);
  }
}

export async function runApi<T>(fn: () => Promise<T>, options?: OperationOptions) {
  const operationId = startOperation(options);
  try {
    const result = await fn();
    logText.value = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    await refreshState();
    return result;
  } catch (error) {
    logText.value = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    finishOperation(operationId);
  }
}
