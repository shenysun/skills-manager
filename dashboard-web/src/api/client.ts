import type { PickerAgent, Scope } from '../domain/picker';
import type { SkillSourceInfo } from '../domain/sourceLink';
import type { DistributionTarget } from '../domain/distribution';

export type SkillRowState = {
  name: string;
  category: string;
  description: string;
  /** Registry source for the 来源 segment; null for imported skills with no provenance (ADR-0006). */
  source: SkillSourceInfo | null;
  hasUpdate: boolean;
  warning: 'broken-link' | 'outdated-copy' | null;
  /** Number of stale copy targets for this skill (ADR-0008). Always 0 for symlink-only skills. */
  staleCount: number;
  distributedAgents: string[];
  /** The hub index grouped by target — the preview's 接入 reverse lookup. */
  distribution: DistributionTarget[];
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
  /** Project targets the operator has distributed to, most recent first (index-derived). */
  knownProjects: string[];
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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { Scope, PickerAgent } from '../domain/picker';

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

export type DistributeMode = 'symlink' | 'copy';

/** Wire shape of GET /api/catalog/agents rows — same type the picker domain reasons about. */
export type CatalogAgent = PickerAgent;

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

export type RefreshResult = { refreshed: number; errored: number; errors: Array<{ runtimePath: string; message: string }> };

/** Refresh every stale copy target of `skill` (ADR-0008). Per-entry failures are surfaced via `errors`, never thrown. */
export function refreshSkill(skill: string) {
  return api<RefreshResult>('/api/distribute/refresh', { method: 'POST', body: JSON.stringify({ skill }) });
}

export type DiscoveredSkill = { name: string; title: string; description: string; subpath: string };

export function discover(source: string) {
  return api<{ discovered: DiscoveredSkill[]; existing: string[] }>('/api/discover', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

export type InitSkillLocation = { agentIds: string[]; runtimeDir: string; path: string };

export type InitDiscoveredSkill = {
  name: string;
  title: string;
  description: string;
  locations: InitSkillLocation[];
};

export type InitConflict = {
  skill: string;
  kind: 'multi-runtime' | 'hub-vs-runtime';
  locations: InitSkillLocation[];
};

export type InitRunResult = {
  dryRun: boolean;
  scanned: Array<{ agentId: string; runtimeDir: string }>;
  discovered: InitDiscoveredSkill[];
  imported: string[];
  skippedManaged: string[];
  conflicts: InitConflict[];
  failed: Array<{ skill: string; reason: string }>;
};

/** Reverse import (ADR-0006): preview is a dry-run of the same operation. */
export function initPreview() {
  return api<InitRunResult>('/api/init/preview', { method: 'POST', body: JSON.stringify({}) });
}

export function initApply(body: { resolve?: Record<string, string> }) {
  return api<InitRunResult>('/api/init/apply', { method: 'POST', body: JSON.stringify(body) });
}

export function installFromSource(body: { source: string; subpaths: string[]; overwrite?: boolean }) {
  return api<{ installed: string[] }>('/api/install', { method: 'POST', body: JSON.stringify(body) });
}

export type BrowseDirectory = {
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
};

export function browseDirectory(path?: string) {
  const params = new URLSearchParams();
  if (path) params.set('path', path);
  return api<BrowseDirectory>(`/api/fs/browse?${params.toString()}`);
}

/** One file of a hub skill, server-rendered (skill preview Sheet). The html is
 *  sanitized server-side — the only server output the client innerHTMLs. */
export type SkillFilePayload =
  | { kind: 'markdown'; html: string; raw: string; truncated: boolean }
  | { kind: 'source'; html: string; truncated: boolean }
  | { kind: 'text'; raw: string; truncated: boolean }
  | { kind: 'binary'; size: number };

export type SkillFileEntry = { path: string; size: number };

export function fetchSkillFile(name: string, filePath: string) {
  const params = new URLSearchParams({ name, path: filePath });
  return api<SkillFilePayload>(`/api/skill/file?${params.toString()}`);
}

/** The skill's full file list for the preview tree, sorted server-side. */
export function fetchSkillFiles(name: string) {
  return api<{ files: SkillFileEntry[] }>(`/api/skill/files?name=${encodeURIComponent(name)}`);
}
