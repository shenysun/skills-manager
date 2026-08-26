export type SkillName = string;

/**
 * Legacy consumer words (pre-catalog). Kept as a local constant only where
 * the one-shot migration bridge and leftover-view cleanup need to recognize
 * them; they are no longer a model-level closed set.
 */
export const LEGACY_CONSUMERS = ['agents', 'claude'] as const;

export type SkillSourceType = 'local' | 'git' | 'github' | string;

export type SkillSource = {
  type?: SkillSourceType;
  url?: string | null;
  subpath?: string | null;
  ref?: string | null;
  upstream_commit?: string | null;
  imported_from?: string[];
};

export type RegistryEntry = {
  path?: string;
  title?: string;
  category?: string;
  tags?: string[];
  /** Desired/default agent ids from the catalog (metadata only; see ADR-0004). */
  consumers?: string[];
  source?: SkillSource;
  update_policy?: string;
  description?: string;
  archived?: boolean;
  /** True when init folded this skill in from a runtime dir; provenance unknown, updates unmanaged (ADR-0006). */
  imported?: boolean;
  /** ISO timestamp of the init import (present only on imported entries). */
  imported_at?: string;
  [key: string]: unknown;
};

export type Registry = {
  skills: Record<SkillName, RegistryEntry>;
};

export type Skill = {
  name: SkillName;
  path: string;
  title: string;
  category: string;
  tags: string[];
  consumers: string[];
  description: string;
  source: SkillSource;
  archived: boolean;
};

export type SkillHome = {
  root: string;
  skillsDir: string;
  viewsDir: string;
  collectionsDir: string;
  registryFile: string;
  activityFile: string;
};

export type SourceSpec = {
  input: string;
  repoUrl: string;
  baseSubpath?: string;
  ref?: string;
  isLocal: boolean;
  treeRest?: string;
};

export type SourceCheckout = SourceSpec & {
  repoDir: string;
  commit: string | null;
};

export type DiscoveredSkill = {
  name: SkillName;
  title: string;
  description: string;
  subpath: string;
  absoluteDir: string;
};

export type InstallPlan = {
  source: SourceCheckout;
  selected: DiscoveredSkill[];
  existing: SkillName[];
  consumers: string[];
  overwrite: boolean;
};

export type InstallResult = {
  installed: SkillName[];
  plan: InstallPlan;
};

export type UpdateCandidate = {
  skill: SkillName;
  url: string;
  subpath: string;
  ref?: string;
  title: string;
  description: string;
  consumers: string[];
};

export type SourceUpdateGroup = {
  key: string;
  url: string;
  ref?: string;
  skills: UpdateCandidate[];
};

export type UpdatePlan = {
  candidates: UpdateCandidate[];
  groups: SourceUpdateGroup[];
};

export type DistributeMode = 'symlink' | 'copy';
export type DistributionTargetKind = 'user' | 'project';

export type DistributionHealth = {
  managedEntries: number;
  agentCoverage: number;
  outdated: number;
  foreign: number;
  leftoverViews: boolean;
};

export type DoctorReport = {
  skillHome: string;
  skillCount: number;
  distribution: DistributionHealth;
  brokenLinks: string[];
  warnings: string[];
  gitStatus: string;
  catalog: { source: 'injected' | 'hub' | 'bundled'; commit: string; date: string; ageDays: number };
  /** Imported entries with no managed source: snapshots that may silently lag their unknown upstream (ADR-0006). */
  importedWithoutSource: Array<{ skill: string; importedAt: string | null }>;
};

/**
 * Dual-layer distribution entry (ADR-0004): the physical layer (runtimePath,
 * mode, fingerprint, managed) is what undistribute/outdated/foreign-refusal
 * operate on; the logical layer (agents) records which catalog agent ids
 * motivated the write and drives reference counting on shared paths.
 */
export type DistributionIndexError = {
  code: string;
  message: string;
  /** ISO timestamp of when the refresh attempt failed. */
  at: string;
};

export type DistributionIndexEntry = {
  skill: SkillName;
  runtimePath: string;
  mode: DistributeMode;
  fingerprint: string;
  managed: boolean;
  agents: string[];
  appliedAt: string;
  /** Set when the most recent refresh attempt failed; cleared on next successful refresh. */
  error?: DistributionIndexError;
};

export type DistributionIndexRecord = {
  id: string;
  kind: DistributionTargetKind;
  targetRoot: string;
  updatedAt: string;
  entries: DistributionIndexEntry[];
};

export type ActivityRecord = {
  id: string;
  timestamp: string;
  action: string;
  summary: string;
  actor?: string;
  details?: Record<string, unknown>;
};

export type PackageInfo = {
  name?: string;
  version?: string;
  bin?: Record<string, string> | string;
  private?: boolean;
  files?: string[];
};

export type PackageCheck = {
  ok: boolean;
  packageJsonPath: string;
  info: PackageInfo;
  warnings: string[];
};
