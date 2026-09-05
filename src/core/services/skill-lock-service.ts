import os from 'node:os';
import path from 'node:path';
import type { SkillName, SkillSource } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';

/**
 * One `skills` entry of the `npx skills` machine-global lock
 * (`.skill-lock.json`). Unvalidated JSON shape — `lockEntryToSource` decides
 * what is usable evidence.
 */
export type SkillLockEntry = {
  sourceType?: unknown;
  sourceUrl?: unknown;
  ref?: unknown;
  skillPath?: unknown;
  skillFolderHash?: unknown;
};

const SKILL_FILE_SUFFIX = '/SKILL.md';

/**
 * Map one lock entry to a registry source, or null when the entry holds no
 * usable evidence (ADR-0011). Only source types skills-manager can actually
 * update are adopted — a recorded-but-unupdatable source is worse than an
 * honest snapshot. `skillFolderHash` (an upstream Git tree SHA) carries over
 * as `baseline_hash`: the only anchor to the upstream version at install time.
 */
export function lockEntryToSource(entry: SkillLockEntry | null | undefined): SkillSource | null {
  if (!entry || typeof entry !== 'object') return null;
  const sourceType = typeof entry.sourceType === 'string' ? entry.sourceType : '';
  const skillPath = typeof entry.skillPath === 'string' ? entry.skillPath : '';
  // Every source type requires a usable skillPath — it is the evidence of where
  // the skill lived upstream (ADR-0011 decision 4).
  if (!skillPath.endsWith(SKILL_FILE_SUFFIX)) return null;
  const baselineHash = typeof entry.skillFolderHash === 'string' ? entry.skillFolderHash : null;
  if (sourceType === 'github' || sourceType === 'git') {
    const sourceUrl = typeof entry.sourceUrl === 'string' ? entry.sourceUrl : '';
    if (!sourceUrl) return null;
    return {
      type: 'git',
      url: sourceUrl,
      // '' means the repo root itself is the skill folder; null is the registry's word for that.
      subpath: skillPath.slice(0, -SKILL_FILE_SUFFIX.length) || null,
      ref: typeof entry.ref === 'string' && entry.ref ? entry.ref : null,
      baseline_hash: baselineHash,
    };
  }
  // A local source's path is its identity: with url+subpath recorded, update and
  // doctor treat it like any sourced skill (update re-copies from the local path).
  // Without a sourceUrl it degrades to an audited snapshot.
  if (sourceType === 'local') {
    const sourceUrl = typeof entry.sourceUrl === 'string' ? entry.sourceUrl : '';
    return {
      type: 'local',
      url: sourceUrl || null,
      subpath: skillPath.slice(0, -SKILL_FILE_SUFFIX.length) || null,
      ref: null,
      baseline_hash: baselineHash,
    };
  }
  return null;
}

export type SkillLockOptions = {
  /** Environment override for path variables (XDG_STATE_HOME); defaults to process.env-free behavior. */
  env?: Record<string, string | undefined>;
  userHomeDir?: string;
};

/**
 * Reads the `npx skills` machine-global lockfile as import evidence
 * (ADR-0011). Upstream keeps it centralized — one file for every agent — at
 * `$XDG_STATE_HOME/skills/.skill-lock.json` or `~/.agents/.skill-lock.json`.
 * Read-only: skills-manager never writes, rewrites, or cleans this file.
 */
export class SkillLockService {
  constructor(private readonly fs: FileSystemPort, private readonly options: SkillLockOptions = {}) {}

  lockPath(): string {
    // An empty XDG_STATE_HOME is unset per the XDG spec, not a root path.
    const xdg = this.options.env?.XDG_STATE_HOME;
    if (xdg) return path.join(xdg, 'skills', '.skill-lock.json');
    return path.join(this.options.userHomeDir ?? os.homedir(), '.agents', '.skill-lock.json');
  }

  /**
   * Parsed entries keyed by skill name. Empty when the lock is absent,
   * malformed, or not schema v3 (upstream wipes pre-v3 locks itself; an
   * unknown future schema is ignored rather than guessed at).
   */
  load(): ReadonlyMap<SkillName, SkillLockEntry> {
    const file = this.lockPath();
    if (this.fs.kind(file) !== 'file') return new Map();
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fs.readText(file));
    } catch {
      return new Map(); // Broken evidence is no evidence — never an init failure.
    }
    if (!parsed || typeof parsed !== 'object') return new Map();
    const lock = parsed as { version?: unknown; skills?: unknown };
    if (lock.version !== 3) return new Map();
    const entries = new Map<SkillName, SkillLockEntry>();
    for (const [name, entry] of Object.entries((lock.skills as Record<string, unknown>) ?? {})) {
      if (entry && typeof entry === 'object') entries.set(name, entry as SkillLockEntry);
    }
    return entries;
  }
}
