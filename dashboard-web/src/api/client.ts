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
