export type SkillRowState = {
  name: string;
  category: string;
  description: string;
  sourceType: string;
  hasUpdate: boolean;
  warning: string | null;
  distributedAgents: string[];
};

export type ActivityRecord = {
  id: string;
  timestamp: string;
  action: string;
  summary: string;
  details?: Record<string, unknown>;
};

export type DashboardState = {
  skills: SkillRowState[];
  activity: ActivityRecord[];
  updateCount: number;
};

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'content-type': 'application/json' }, ...init });
  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!payload) throw new Error(`${response.status} ${response.statusText}`);
  if (!payload.ok) throw new ApiError(payload.error.code, payload.error.message, payload.error.details);
  return payload.data;
}

/** The library is always refetched from the server — never cached across reloads (ADR-0005). */
export function fetchState() {
  return api<DashboardState>('/api/state');
}

export type Scope = 'user' | 'project';
export type DistributeMode = 'symlink' | 'copy';

export type CatalogAgent = {
  id: string;
  label: string;
  detected: boolean;
  familyKey: string | null;
  invalidReason: string | null;
};

export function fetchCatalogAgents(scope: Scope, projectRoot?: string) {
  const params = new URLSearchParams({ scope });
  if (projectRoot) params.set('projectRoot', projectRoot);
  return api<{ scope: Scope; agents: CatalogAgent[] }>(`/api/catalog/agents?${params.toString()}`);
}

export function distribute(body: {
  to: Scope;
  projectRoot?: string;
  skills: string[];
  agents: string[];
  mode: DistributeMode;
}) {
  return api<unknown>('/api/distribute', { method: 'POST', body: JSON.stringify(body) });
}

export function undistribute(body: { to: Scope; projectRoot?: string; skills: string[]; agents: string[] }) {
  return api<{ removed: unknown[] }>('/api/undistribute', { method: 'POST', body: JSON.stringify(body) });
}

export type RemoveResult = { skill: string; ok: true; removed: number } | { skill: string; ok: false; error: { code: string; message: string } };

export function removeSkills(skills: string[]) {
  return api<{ results: RemoveResult[] }>('/api/skills/remove', { method: 'POST', body: JSON.stringify({ skills }) });
}

export function updateSkills(skills: string[]) {
  return api<{ updated: string[] }>('/api/update/skills', { method: 'POST', body: JSON.stringify({ skills }) });
}

export type DiscoveredSkill = { name: string; title: string; description: string; subpath: string };

export function discover(source: string) {
  return api<{ discovered: DiscoveredSkill[]; existing: string[] }>('/api/discover', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export function installFromSource(body: { source: string; subpaths: string[]; overwrite?: boolean }) {
  return api<{ installed: string[] }>('/api/install', { method: 'POST', body: JSON.stringify(body) });
}
