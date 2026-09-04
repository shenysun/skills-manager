import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  LEGACY_CONSUMERS,
  type DistributeMode,
  type DistributionHealth,
  type DistributionIndexEntry,
  type DistributionIndexRecord,
  type DistributionTargetKind,
  type SkillHome,
  type SkillName,
} from '../model/index.js';
import type { CatalogService } from './catalog-service.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName, isLegacyConsumer } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';

export type DistributeRequest = {
  to: DistributionTargetKind;
  projectRoot?: string;
  skills: readonly string[];
  /** Catalog agent ids; omitted = the detected set on this machine. */
  agents?: readonly string[];
  mode?: DistributeMode;
  force?: boolean;
};

type TargetRef = {
  kind: DistributionTargetKind;
  targetRoot: string;
  id: string;
};

type PhysicalGroup = {
  runtimeDir: string;
  agents: string[];
};

type SnapshotManifest = {
  kind: DistributionTargetKind;
  targetRoot: string;
  record: DistributionIndexRecord | null;
};

export class DistributeService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly catalog: CatalogService,
    private readonly userHome: string = os.homedir(),
  ) {}

  apply(request: DistributeRequest) {
    const target = this.resolveTarget(request.to, request.projectRoot);
    const agents = this.resolveAgents(request.agents);
    const skills = this.requireCanonicalSkills(request.skills);
    const mode = request.mode ?? (request.to === 'user' ? 'symlink' : 'copy');
    this.assertMode(mode);
    this.snapshotRestorePoint(target);
    const appliedAt = new Date().toISOString();
    const groups = this.physicalGroups(agents, target);
    const entries: DistributionIndexEntry[] = [];
    for (const skill of skills) {
      const fingerprint = this.fingerprint(skill);
      for (const group of groups) {
        entries.push(this.applyOne(target, skill, group, mode, fingerprint, appliedAt, Boolean(request.force)));
      }
    }
    return { target, mode, agents, entries };
  }

  undistribute(request: Omit<DistributeRequest, 'mode' | 'force'>) {
    const target = this.resolveTarget(request.to, request.projectRoot);
    const agents = this.resolveAgents(request.agents);
    const skills = [...request.skills];
    for (const skill of skills) assertSafeSkillName(skill);
    this.snapshotRestorePoint(target);
    const record = this.loadRecord(target.id);
    const kept: DistributionIndexEntry[] = [];
    const removed: DistributionIndexEntry[] = [];
    for (const entry of record?.entries || []) {
      if (!skills.includes(entry.skill)) {
        kept.push(entry);
        continue;
      }
      const remaining = entry.agents.filter((id) => !agents.includes(id));
      if (remaining.length === entry.agents.length) {
        kept.push(entry);
        continue;
      }
      if (remaining.length === 0) {
        this.removeManagedPath(entry.runtimePath);
        removed.push(entry);
      } else {
        kept.push({ ...entry, agents: remaining });
      }
    }
    this.writeRecord(target, kept);
    return { target, removed };
  }

  redistributeOutdated(filter: { to?: DistributionTargetKind; projectRoot?: string; force?: boolean } = {}) {
    const records = this.loadIndex().filter((record) => {
      if (filter.to && record.kind !== filter.to) return false;
      if (filter.projectRoot && path.resolve(filter.projectRoot) !== path.resolve(record.targetRoot)) return false;
      return true;
    });
    const refreshed: DistributionIndexEntry[] = [];
    const errored: DistributionIndexEntry[] = [];
    for (const record of records) {
      const nextEntries: DistributionIndexEntry[] = [];
      for (const entry of record.entries) {
        if (!this.entryNeedsRefresh(entry)) {
          nextEntries.push(entry);
          continue;
        }
        const { entry: nextEntry, ok } = this.refreshEntryOrRecord(record, entry, filter.force);
        nextEntries.push(nextEntry);
        if (ok) refreshed.push(nextEntry);
        else errored.push(nextEntry);
      }
      if (nextEntries.length !== record.entries.length || nextEntries.some((e, i) => e !== record.entries[i])) {
        this.writeRecord({ kind: record.kind, targetRoot: record.targetRoot, id: record.id }, nextEntries);
      }
    }
    return { refreshed, errored };
  }

  /** Refresh every stale copy target of `skill` across all records. Used by install / update cascade. */
  redistributeOutdatedForSkill(skill: SkillName) {
    const refreshed: DistributionIndexEntry[] = [];
    const errored: DistributionIndexEntry[] = [];
    for (const record of this.loadIndex()) {
      const targets = record.entries.filter((entry) => entry.skill === skill);
      if (targets.length === 0) continue;
      const nextEntries = [...record.entries];
      for (const entry of targets) {
        if (!this.entryNeedsRefresh(entry)) continue;
        const { entry: nextEntry, ok } = this.refreshEntryOrRecord(record, entry);
        nextEntries[nextEntries.findIndex((e) => e === entry)] = nextEntry;
        if (ok) refreshed.push(nextEntry);
        else errored.push(nextEntry);
      }
      if (nextEntries.length !== record.entries.length || nextEntries.some((e, i) => e !== record.entries[i])) {
        this.writeRecord({ kind: record.kind, targetRoot: record.targetRoot, id: record.id }, nextEntries);
      }
    }
    return { refreshed, errored };
  }

  /** Refresh admission mirrors the stale badge predicate (`entry.error || entryOutdated`):
   *  an errored entry stays refreshable even once its fingerprint matches again. */
  private entryNeedsRefresh(entry: DistributionIndexEntry) {
    return this.entryOutdated(entry) || Boolean(entry.error);
  }

  /** Refresh one stale entry, or record the failure on it — ADR-0008: a failing entry never blocks siblings. */
  private refreshEntryOrRecord(record: DistributionIndexRecord, entry: DistributionIndexEntry, force?: boolean): { entry: DistributionIndexEntry; ok: boolean } {
    try {
      return { entry: this.refreshStaleEntry(record, entry, force), ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof SkillsManagerError ? error.code : 'refresh_failed';
      return { entry: { ...entry, error: { code, message, at: new Date().toISOString() } }, ok: false };
    }
  }

  /**
   * Refresh one entry by re-running apply() for it. THROWS on failure — the
   * caller catches and records the error on the entry (ADR-0008). `force`
   * defaults to false, so an unmanaged foreign file at the target throws
   * `distribute_foreign_exists` for the caller to catch and record.
   */
  refreshStaleEntry(record: DistributionIndexRecord, entry: DistributionIndexEntry, force?: boolean): DistributionIndexEntry {
    // The runtime directory's parent must still exist — we don't silently resurrect
    // a runtime root that the user removed out from under us (ADR-0008).
    if (this.fs.kind(path.dirname(entry.runtimePath)) === 'missing') {
      throw new SkillsManagerError('distribute_target_missing', `Refresh target no longer exists: ${entry.runtimePath}`, { runtimePath: entry.runtimePath, skill: entry.skill, agents: entry.agents });
    }
    const result = this.apply({
      to: record.kind,
      projectRoot: record.kind === 'project' ? record.targetRoot : undefined,
      skills: [entry.skill],
      agents: entry.agents,
      mode: entry.mode,
      force: Boolean(force),
    });
    // `apply` writes its own record; the returned entry carries the new fingerprint and appliedAt.
    // Strip any prior error — the refresh succeeded.
    const next = result.entries.find((e) => e.runtimePath === entry.runtimePath) ?? result.entries[0];
    return { ...next, error: undefined };
  }

  rollback(to: DistributionTargetKind, projectRoot?: string) {
    const target = this.resolveTarget(to, projectRoot);
    if (target.kind === 'project') {
      throw new SkillsManagerError('distribute_project_rollback_unsupported', 'project rollback not supported — git is the restore point for project targets');
    }
    const latest = this.latestBackupDir(target);
    if (!latest) throw new SkillsManagerError('distribute_no_rollback', `No restore point for ${target.id}`);
    const manifest = YAML.parse(this.fs.readText(path.join(latest, 'manifest.yaml'))) as SnapshotManifest;
    const current = this.loadRecord(target.id);
    for (const entry of current?.entries || []) this.removeManagedPath(entry.runtimePath);
    const trees = path.join(latest, 'trees');
    if (this.fs.kind(trees) === 'directory') {
      for (const entry of manifest.record?.entries || []) {
        const source = path.join(trees, this.safeId(entry.runtimePath), entry.skill);
        if (this.fs.kind(source) === 'missing') continue;
        this.fs.makeDirectory(path.dirname(entry.runtimePath));
        this.replacePath(entry.runtimePath);
        const kind = this.fs.kind(source);
        if (kind === 'symlink') this.fs.symlink(this.fs.readlink(source), entry.runtimePath);
        else if (kind === 'directory') this.fs.copyDirectoryContents(source, entry.runtimePath);
      }
    }
    if (manifest.record) this.replaceIndexRecord(manifest.record);
    else this.writeRecord(target, []);
    return { target, restoredFrom: latest };
  }

  migrateViews(options: { deleteViews?: boolean; force?: boolean } = {}) {
    const skipped: string[] = [];
    const distributed: string[] = [];
    for (const consumer of LEGACY_CONSUMERS) {
      const agentId = this.legacyConsumerAgent(consumer);
      const names = new Set<string>();
      const viewDir = path.join(this.home.viewsDir, consumer);
      if (this.fs.kind(viewDir) === 'directory') {
        for (const entry of this.fs.readDirectory(viewDir)) names.add(entry.name);
      }
      const registry = this.registry.load();
      for (const [skill, item] of Object.entries(registry.skills || {})) {
        if ((item.consumers || []).includes(consumer) && !item.archived) names.add(skill);
      }
      for (const skill of names) {
        if (!this.registry.skillExists(skill)) continue;
        try {
          this.apply({ to: 'user', skills: [skill], agents: [agentId], force: options.force });
          distributed.push(`${consumer}:${skill}`);
        } catch (error) {
          if (error instanceof SkillsManagerError && error.code === 'distribute_foreign_exists') skipped.push(`${consumer}:${skill}`);
          else throw error;
        }
      }
    }
    if (options.deleteViews) this.deleteGeneratedViews();
    return { distributed, skipped };
  }

  status(): DistributionHealth {
    const records = this.loadIndex();
    let managedEntries = 0;
    const coveredAgents = new Set<string>();
    let outdated = 0;
    for (const record of records) {
      for (const entry of record.entries) {
        if (this.fs.kind(entry.runtimePath) === 'missing') continue;
        managedEntries += 1;
        entry.agents.forEach((id) => coveredAgents.add(id));
        if (this.entryOutdated(entry)) outdated += 1;
      }
    }
    return {
      managedEntries,
      agentCoverage: coveredAgents.size,
      outdated,
      foreign: this.countForeign(records),
      leftoverViews: this.fs.kind(this.home.viewsDir) === 'directory',
    };
  }

  leftoverViewWarning() {
    if (this.fs.kind(this.home.viewsDir) !== 'directory') return null;
    return `Leftover hub views/ tree at ${this.home.viewsDir} is not a consumer load path. Run migrate-views if user runtimes still need wiring.`;
  }

  archivedDistributedWarnings() {
    const warnings: string[] = [];
    const registry = this.registry.load();
    for (const record of this.loadIndex()) {
      for (const entry of record.entries) {
        if (registry.skills?.[entry.skill]?.archived) {
          warnings.push(`Distributed skill is archived on the hub: ${entry.skill} (${record.kind} ${entry.agents.join(',')})`);
        }
        if (!this.registry.skillExists(entry.skill)) {
          warnings.push(`Distributed skill is missing from the hub: ${entry.skill} (${entry.runtimePath})`);
        }
      }
    }
    return warnings;
  }

  runtimeBrokenLinks() {
    const broken: string[] = [];
    for (const record of this.loadIndex()) {
      for (const entry of record.entries) {
        if (this.fs.kind(entry.runtimePath) === 'symlink' && this.fs.targetKind(entry.runtimePath) === 'missing') broken.push(entry.runtimePath);
      }
    }
    return broken;
  }

  fingerprint(skill: SkillName) {
    return this.fingerprintDir(this.registry.skillDir(skill));
  }

  /** Full-tree fingerprint of any skill directory (hub or runtime). */
  fingerprintDir(root: string) {
    const hash = createHash('sha256');
    for (const relative of this.listTree(root)) {
      const full = path.join(root, relative);
      const kind = this.fs.kind(full);
      hash.update(relative);
      hash.update('\0');
      hash.update(kind);
      hash.update('\0');
      if (kind === 'file') hash.update(this.fs.readText(full));
      else if (kind === 'symlink') hash.update(this.fs.readlink(full));
    }
    return `sha256:${hash.digest('hex')}`;
  }

  indexPath() {
    return path.join(this.home.root, '.skills', 'distributions.jsonl');
  }

  listIndex() {
    return this.loadIndex();
  }

  /**
   * Per-skill count of distribution entries that are stale or errored.
   * `entryOutdated` short-circuits on symlink entries, so symlinks are
   * never counted — same rule the cascade refresh uses.
   */
  staleSummary(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const record of this.loadIndex()) {
      for (const entry of record.entries) {
        if (entry.error || this.entryOutdated(entry)) {
          result[entry.skill] = (result[entry.skill] ?? 0) + 1;
        }
      }
    }
    return result;
  }

  private applyOne(target: TargetRef, skill: SkillName, group: PhysicalGroup, mode: DistributeMode, fingerprint: string, appliedAt: string, force: boolean): DistributionIndexEntry {
    const runtimePath = path.join(group.runtimeDir, skill);
    this.fs.makeDirectory(group.runtimeDir);
    assertPathInside(runtimePath, group.runtimeDir);
    const kind = this.fs.kind(runtimePath);
    const record = this.loadRecord(target.id);
    const existing = record?.entries.find((item) => item.skill === skill && item.runtimePath === runtimePath);
    if (kind !== 'missing' && !existing && !force) {
      throw new SkillsManagerError('distribute_foreign_exists', `Refusing to overwrite unmanaged skill at ${runtimePath}`, { runtimePath, skill, agents: group.agents });
    }
    this.replacePath(runtimePath);
    const hubSkill = this.registry.skillDir(skill);
    if (mode === 'symlink') this.fs.symlink(hubSkill, runtimePath);
    else this.fs.copyDirectoryContents(hubSkill, runtimePath);
    const agents = [...new Set([...(existing?.agents || []), ...group.agents])].sort();
    const entry: DistributionIndexEntry = { skill, runtimePath, mode, fingerprint, managed: true, agents, appliedAt };
    const next = [...(record?.entries || []).filter((item) => !(item.skill === skill && item.runtimePath === runtimePath)), entry];
    this.writeRecord(target, next);
    return entry;
  }

  private resolveAgents(requested: readonly string[] | undefined): string[] {
    const ids = requested !== undefined ? [...new Set(requested)].sort() : this.catalog.detected();
    if (ids.length === 0) {
      throw new SkillsManagerError('distribute_no_agents', 'No agents selected and none detected on this machine. Pass --agent <id...>; run `skills-manager catalog info` to see the catalog.');
    }
    const known = new Set(this.catalog.load().agents.map((agent) => agent.id));
    const invalid = ids.filter((id) => !known.has(id));
    if (invalid.length > 0) {
      throw new SkillsManagerError('distribute_unknown_agent', `Unknown agent id(s): ${invalid.join(', ')}. Run \`skills-manager catalog info\` to list valid catalog ids.`);
    }
    return ids;
  }

  /** Resolve agent ids into deduplicated physical runtime dirs (one write each). */
  private physicalGroups(agentIds: readonly string[], target: TargetRef): PhysicalGroup[] {
    const snapshot = this.catalog.load();
    const byDir = new Map<string, string[]>();
    for (const id of agentIds) {
      const agent = snapshot.agents.find((item) => item.id === id);
      if (!agent) throw new SkillsManagerError('distribute_unknown_agent', `Unknown agent id: ${id}`);
      if (target.kind === 'user') {
        if (!agent.globalSkillsDir) {
          throw new SkillsManagerError('distribute_agent_project_only', `Agent "${id}" has no global runtime path in the catalog (project-only). Use --to project for this agent.`);
        }
        const resolved = this.catalog.resolveGlobalDir(id);
        if (resolved === null) {
          throw new SkillsManagerError('distribute_path_unresolvable', `Cannot resolve global runtime dir for agent "${id}": ${agent.globalSkillsDir}`);
        }
        const members = byDir.get(resolved) || [];
        byDir.set(resolved, [...members, id]);
      } else {
        const dir = path.join(target.targetRoot, agent.skillsDir);
        const members = byDir.get(dir) || [];
        byDir.set(dir, [...members, id]);
      }
    }
    return [...byDir.entries()].map(([runtimeDir, agents]) => ({ runtimeDir, agents: agents.sort() }));
  }

  private requireCanonicalSkills(names: readonly string[]) {
    const skills = [...names];
    if (skills.length === 0) throw new SkillsManagerError('distribute_skill_missing', 'At least one skill is required');
    for (const skill of skills) {
      assertSafeSkillName(skill);
      if (!this.registry.skillExists(skill)) throw new SkillsManagerError('distribute_skill_missing', `Canonical skill not found: ${skill}`, { skill });
    }
    return skills;
  }

  private resolveTarget(kind: DistributionTargetKind, projectRoot?: string): TargetRef {
    if (kind !== 'user' && kind !== 'project') throw new SkillsManagerError('distribute_project_required', `Unknown target kind: ${kind}`);
    if (kind === 'project') {
      if (!projectRoot) throw new SkillsManagerError('distribute_project_required', 'Project distribute requires --project');
      const targetRoot = path.resolve(projectRoot);
      return { kind, targetRoot, id: `project:${targetRoot}` };
    }
    const targetRoot = path.resolve(this.userHome);
    return { kind, targetRoot, id: `user:${targetRoot}` };
  }

  private assertMode(mode: DistributeMode) {
    if (mode !== 'symlink' && mode !== 'copy') throw new SkillsManagerError('invalid_distribute_mode', `Unknown mode: ${mode}`);
  }

  /** Family representative for a legacy consumer tag: one catalog id whose global dir matches the old hardcoded path. */
  private legacyConsumerAgent(consumer: string): string {
    if (consumer === 'claude') {
      const agent = this.catalog.load().agents.find((item) => item.globalSkillsDir?.startsWith('$claudeHome') || item.globalSkillsDir === '~/.claude/skills');
      if (!agent) throw new SkillsManagerError('distribute_unknown_agent', 'Catalog has no agent for the legacy claude runtime path');
      return agent.id;
    }
    const family = this.catalog.load().agents.filter((item) => item.globalSkillsDir === '~/.agents/skills');
    if (family.length === 0) throw new SkillsManagerError('distribute_unknown_agent', 'Catalog has no shared ~/.agents/skills family for the legacy agents tag');
    return family.map((item) => item.id).sort()[0];
  }

  private entryOutdated(entry: DistributionIndexEntry) {
    if (!this.registry.skillExists(entry.skill)) return false;
    if (entry.mode === 'symlink') return false; // symlinks always proxy the live hub tree
    return entry.fingerprint !== this.fingerprint(entry.skill);
  }

  private loadIndex(): DistributionIndexRecord[] {
    if (this.fs.kind(this.indexPath()) !== 'file') return [];
    const records = this.fs.readText(this.indexPath())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DistributionIndexRecord);
    const legacy = records.some((record) => record.entries.some((entry) => isLegacyConsumer((entry as { consumer?: string }).consumer ?? '')));
    if (legacy) {
      throw new SkillsManagerError('legacy_consumer_tags', 'The hub distribution index still uses legacy consumer entries. Run `skills-manager migrate-consumers` to migrate them to catalog agent ids.');
    }
    return records;
  }

  private loadRecord(id: string) {
    return this.loadIndex().find((record) => record.id === id) || null;
  }

  private writeRecord(target: TargetRef, entries: DistributionIndexEntry[]) {
    const record: DistributionIndexRecord = {
      id: target.id,
      kind: target.kind,
      targetRoot: target.targetRoot,
      updatedAt: new Date().toISOString(),
      entries,
    };
    this.replaceIndexRecord(record, entries.length === 0);
  }

  private replaceIndexRecord(record: DistributionIndexRecord, drop = false) {
    const next = this.loadIndex().filter((item) => item.id !== record.id);
    if (!drop) next.push(record);
    this.fs.makeDirectory(path.dirname(this.indexPath()));
    this.fs.writeText(this.indexPath(), next.map((item) => JSON.stringify(item)).join('\n') + (next.length ? '\n' : ''));
  }

  private backupRoot(target: TargetRef) {
    return path.join(this.home.root, '.skills', 'distribute-backups', this.safeId(target.id));
  }

  private safeId(id: string) {
    return id.replace(/[^A-Za-z0-9._-]+/g, '_');
  }

  /** Only user targets keep a hub-side restore point; project targets rely on git (ADR-0007). */
  private snapshotRestorePoint(target: TargetRef) {
    if (target.kind === 'user') this.snapshot(target);
  }

  private snapshot(target: TargetRef) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.backupRoot(target), timestamp);
    this.fs.makeDirectory(dir);
    const record = this.loadRecord(target.id);
    this.fs.writeText(path.join(dir, 'manifest.yaml'), YAML.stringify({ kind: target.kind, targetRoot: target.targetRoot, record } satisfies SnapshotManifest, { lineWidth: 0 }));
    const trees = path.join(dir, 'trees');
    for (const entry of record?.entries || []) {
      if (this.fs.kind(entry.runtimePath) === 'missing') continue;
      const dest = path.join(trees, this.safeId(entry.runtimePath), entry.skill);
      this.fs.makeDirectory(path.dirname(dest));
      // Same-millisecond snapshots reuse the timestamped dir; keep the write idempotent.
      this.replacePath(dest);
      const kind = this.fs.kind(entry.runtimePath);
      if (kind === 'symlink') this.fs.symlink(this.fs.readlink(entry.runtimePath), dest);
      else if (kind === 'directory') this.fs.copyDirectoryContents(entry.runtimePath, dest);
    }
  }

  private latestBackupDir(target: TargetRef) {
    const root = this.backupRoot(target);
    if (this.fs.kind(root) !== 'directory') return null;
    const dirs = this.fs.readDirectory(root).filter((entry) => entry.kind === 'directory').map((entry) => entry.name).sort();
    if (dirs.length === 0) return null;
    return path.join(root, dirs[dirs.length - 1]);
  }

  private removeManagedPath(runtimePath: string) {
    const kind = this.fs.kind(runtimePath);
    if (kind === 'missing') return;
    if (kind === 'directory') this.fs.removeTree(runtimePath);
    else this.fs.removeFileOrSymlink(runtimePath);
  }

  private replacePath(runtimePath: string) {
    this.removeManagedPath(runtimePath);
  }

  private deleteGeneratedViews() {
    if (this.fs.kind(this.home.viewsDir) !== 'directory') return;
    for (const consumer of LEGACY_CONSUMERS) {
      const dir = path.join(this.home.viewsDir, consumer);
      if (this.fs.kind(dir) !== 'directory') continue;
      for (const entry of this.fs.readDirectory(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.kind === 'directory') throw new SkillsManagerError('unsafe_view_delete', `Refusing to delete a real directory from leftover views: ${full}`);
        this.fs.removeFileOrSymlink(full);
      }
    }
  }

  private countForeign(records: DistributionIndexRecord[]) {
    const managed = new Set(records.flatMap((record) => record.entries.map((entry) => entry.runtimePath)));
    const roots = new Set(records.flatMap((record) => record.entries.map((entry) => path.dirname(entry.runtimePath))));
    let foreign = 0;
    for (const root of roots) {
      if (this.fs.kind(root) !== 'directory') continue;
      for (const entry of this.fs.readDirectory(root)) {
        if (!managed.has(path.join(root, entry.name))) foreign += 1;
      }
    }
    return foreign;
  }

  private listTree(root: string, prefix = ''): string[] {
    if (this.fs.kind(root) !== 'directory') return [];
    const names: string[] = [];
    for (const entry of this.fs.readDirectory(root).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      names.push(relative);
      if (entry.kind === 'directory') names.push(...this.listTree(path.join(root, entry.name), relative));
    }
    return names;
  }
}
