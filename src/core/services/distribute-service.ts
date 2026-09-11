import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  LEGACY_CONSUMERS,
  type AppliedCategorySet,
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
import { assertPathInside, assertSafeSkillName, isLegacyConsumer, normalizeTags } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';
import { MANAGER_SKILL_NAME } from './manager-skill-service.js';

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

/** A validated DistributeRequest: resolved agents, canonical skills, settled mode. */
type ApplyPlan = {
  agents: string[];
  skills: string[];
  mode: DistributeMode;
};

/** One request's fate inside an applyMany batch: its result, or the error it failed with. */
type ApplyOutcome =
  | { request: DistributeRequest; error: null; result: { target: TargetRef; mode: DistributeMode; agents: string[]; entries: DistributionIndexEntry[] } }
  | { request: DistributeRequest; error: SkillsManagerError; result: null };

/** Index entries are keyed by (skill, physical runtime path). */
function applyEntryKey(skill: SkillName, runtimePath: string) {
  return `${skill} ${runtimePath}`;
}

/** One physical runtime path's outcome of a categories apply (ADR-0015). */
export type CategoryApplyPathOutcome = {
  runtimeDir: string;
  agents: string[];
  distributed: SkillName[];
  removed: SkillName[];
  /** Managed entries already on the path that the set keeps (manager skill included). */
  retained: number;
};

export type CategoryApplyResult = {
  agents: string[];
  /** Applied category list; empty when the full managed set was applied (--all). */
  categories: string[];
  /** True when this apply dissolved the filter (`apply --all`). */
  all: boolean;
  paths: CategoryApplyPathOutcome[];
};

/** One physical runtime path's filter state (ADR-0015): the applied set and what has drifted since. */
export type CategorySetStatusPath = {
  runtimeDir: string;
  agents: string[];
  /** The applied set — a category list, the `--all` marker, or null when the path was never applied. */
  applied: AppliedCategorySet | null;
  /** Skills that currently match the effective set (the full managed set under `--all`) but have no live entry on this path. */
  drift: SkillName[];
};

type SnapshotManifest = {
  kind: DistributionTargetKind;
  targetRoot: string;
  record: DistributionIndexRecord | null;
};

/** How many user-target restore points to keep before pruning the oldest. */
const RESTORE_POINTS_KEPT = 5;

export class DistributeService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly catalog: CatalogService,
    private readonly userHome: string = os.homedir(),
  ) {}

  apply(request: DistributeRequest) {
    const { applies } = this.applyMany([request]);
    const outcome = applies[0];
    if (outcome.error) throw outcome.error;
    return outcome.result;
  }

  /**
   * Batch apply against one target: a single restore point, a single index
   * read, and a single index write for N requests. Each request carries its
   * own skills/agents/mode; a failing request is reported and never aborts
   * the rest. `apply` is the single-request wrapper with its original
   * throw-on-error contract.
   */
  applyMany(requests: ReadonlyArray<DistributeRequest>): { target: TargetRef; applies: ApplyOutcome[] } {
    if (requests.length === 0) {
      throw new SkillsManagerError('distribute_skill_missing', 'At least one request is required');
    }
    const target = this.resolveTarget(requests[0].to, requests[0].projectRoot);
    for (const request of requests) {
      const resolved = this.resolveTarget(request.to, request.projectRoot);
      if (resolved.id !== target.id) {
        throw new SkillsManagerError('distribute_batch_target_mismatch', 'applyMany requires every request to target the same distribution target.');
      }
    }

    // Validate each request on its own: a bad request is one outcome, not a failed batch.
    const validated = requests.map((request):
      | { request: DistributeRequest; plan: ApplyPlan; error: null }
      | { request: DistributeRequest; plan: null; error: SkillsManagerError } => {
      try {
        const agents = this.resolveAgents(request.agents);
        const skills = this.requireCanonicalSkills(request.skills);
        const mode = request.mode ?? (request.to === 'user' ? 'symlink' : 'copy');
        this.assertMode(mode);
        return { request, plan: { agents, skills, mode }, error: null };
      } catch (error) {
        return { request, plan: null, error: error as SkillsManagerError };
      }
    });

    // Snapshot only when something will actually change — a fully invalid batch leaves no restore point, matching apply.
    if (validated.some((item) => item.plan !== null)) this.snapshotRestorePoint(target);

    const merged = new Map((this.loadRecord(target.id)?.entries ?? []).map((entry) => [applyEntryKey(entry.skill, entry.runtimePath), entry]));
    const applies: ApplyOutcome[] = validated.map((item) => {
      if (!item.plan) return { request: item.request, error: item.error, result: null };
      const plan = item.plan;
      try {
        const appliedAt = new Date().toISOString();
        const groups = this.physicalGroups(plan.agents, target);
        const entries: DistributionIndexEntry[] = [];
        for (const skill of plan.skills) {
          const fingerprint = this.fingerprint(skill);
          for (const group of groups) {
            const entry = this.applyOne(skill, group, plan.mode, fingerprint, appliedAt, Boolean(item.request.force), merged);
            entries.push(entry);
            merged.set(applyEntryKey(entry.skill, entry.runtimePath), entry);
          }
        }
        return { request: item.request, error: null, result: { target, mode: plan.mode, agents: plan.agents, entries } };
      } catch (error) {
        return { request: item.request, error: error as SkillsManagerError, result: null };
      }
    });

    this.writeRecord(target, [...merged.values()]);
    return { target, applies };
  }

  /**
   * Rewrite the selected agents' runtime dirs to exactly the managed skills in
   * `categories` (ADR-0015): distribute what the set is missing, remove managed
   * entries that are not in the set (uncategorized included), leave the manager
   * skill and foreign entries alone. One rewrite per physical runtime path; the
   * applied set is recorded per path. Rerunning the same apply changes nothing.
   */
  applyCategorySet(categories: readonly string[], agents?: readonly string[]): CategoryApplyResult {
    const set = normalizeTags(categories);
    this.assertCategorySet({ categories: set });
    return this.rewriteToWanted(this.wantedSkills({ categories: set }), { categories: set }, agents);
  }

  /**
   * Dissolve the category filter (ADR-0015, spec story 12): the selected paths'
   * runtime dirs go back to the full managed set — every hub skill is
   * replay-distributed, and the category-set record becomes the `--all` marker.
   * The manager skill stays exempt (retained, never force-distributed); foreign
   * entries stay untouched. Rerunning changes nothing.
   */
  applyAllCategories(agents?: readonly string[]): CategoryApplyResult {
    return this.rewriteToWanted(this.wantedSkills({ all: true }), { all: true }, agents);
  }

  /** Managed hub skills every category apply draws from — the manager skill is never in the pool. */
  private manageableSkills() {
    return this.registry.listSkills().filter((skill) => skill.name !== MANAGER_SKILL_NAME);
  }

  /** The skills an applied set covers: the full managed pool under `--all`, otherwise exactly those tagged in the list. */
  private wantedSkills(applied: AppliedCategorySet): Set<SkillName> {
    return new Set(
      this.manageableSkills()
        .filter((skill) => 'all' in applied || skill.categories.some((category) => applied.categories.includes(category)))
        .map((skill) => skill.name),
    );
  }

  /** Per-path rewrite kernel shared by apply and apply --all; see applyCategorySet for the semantics. */
  private rewriteToWanted(wanted: ReadonlySet<SkillName>, applied: AppliedCategorySet, agents?: readonly string[]): CategoryApplyResult {
    const target = this.resolveTarget('user');
    const agentIds = this.resolveAgents(agents);
    const groups = this.physicalGroups(agentIds, target);
    const record = this.loadRecord(target.id);
    const merged = new Map((record?.entries ?? []).map((entry) => [applyEntryKey(entry.skill, entry.runtimePath), entry]));

    const plans = this.planPathRewrites(groups, wanted, record?.entries ?? []);
    this.assertNoForeignCollisions(plans);

    // The path now serves the selected agents: fold them into every entry that
    // stays on it, so agent coverage never disagrees with the applied selection.
    let entriesChanged = false;
    for (const plan of plans) {
      for (const entry of plan.kept) {
        const joined = [...new Set([...entry.agents, ...plan.group.agents])].sort();
        if (joined.length === entry.agents.length) continue;
        merged.set(applyEntryKey(entry.skill, entry.runtimePath), { ...entry, agents: joined });
        entriesChanged = true;
      }
    }

    const runtimeChanged = plans.some((plan) => plan.removed.length > 0 || plan.distributed.length > 0);
    if (runtimeChanged) this.snapshotRestorePoint(target);
    const appliedAt = new Date().toISOString();
    for (const plan of plans) {
      // Strict per-path semantics: the entry goes even when an unselected
      // family agent still references it — undistribute's per-agent reference
      // counting cannot express "rewrite this whole path" (ADR-0015).
      for (const entry of plan.removed) {
        this.removeManagedPath(entry.runtimePath);
        merged.delete(applyEntryKey(entry.skill, entry.runtimePath));
      }
      for (const skill of plan.distributed) {
        const entry = this.applyOne(skill, plan.group, 'symlink', this.fingerprint(skill), appliedAt, false, merged);
        merged.set(applyEntryKey(entry.skill, entry.runtimePath), entry);
      }
    }

    const categorySets = { ...record?.categorySets };
    let setsChanged = false;
    for (const plan of plans) {
      const existing = categorySets[plan.dir];
      if (existing && this.sameAppliedSet(existing, applied)) continue;
      categorySets[plan.dir] = applied;
      setsChanged = true;
    }
    if (runtimeChanged || entriesChanged || setsChanged) this.rewriteRecord(target, [...merged.values()], categorySets);

    return {
      agents: agentIds,
      categories: 'categories' in applied ? applied.categories : [],
      all: 'all' in applied,
      paths: plans.map((plan) => ({
        runtimeDir: plan.dir,
        agents: plan.group.agents,
        distributed: plan.distributed,
        removed: plan.removed.map((entry) => entry.skill),
        retained: plan.kept.length,
      })),
    };
  }

  /** Plan one rewrite per physical path: which managed entries leave, which stay, which wanted skills are missing. */
  private planPathRewrites(groups: readonly PhysicalGroup[], wanted: ReadonlySet<SkillName>, entries: readonly DistributionIndexEntry[]) {
    return groups.map((group) => {
      const dir = path.resolve(group.runtimeDir);
      const atDir = entries.filter((entry) => path.resolve(path.dirname(entry.runtimePath)) === dir);
      const removed = atDir.filter((entry) => entry.skill !== MANAGER_SKILL_NAME && !wanted.has(entry.skill));
      const kept = atDir.filter((entry) => !removed.includes(entry));
      const distributed = [...wanted].filter((skill) => {
        const entry = kept.find((item) => item.skill === skill);
        return entry === undefined || this.fs.kind(entry.runtimePath) === 'missing';
      });
      return { group, dir, removed, kept, distributed };
    });
  }

  /** Fail fast on foreign name collisions before anything is written — an apply that throws mid-rewrite must stay rerunnable as-is (interruption recovery is "run it again", spec story 17). */
  private assertNoForeignCollisions(plans: ReadonlyArray<{ group: PhysicalGroup; distributed: SkillName[] }>) {
    const collisions = plans.flatMap((plan) =>
      plan.distributed
        .filter((skill) => this.fs.kind(path.join(plan.group.runtimeDir, skill)) !== 'missing')
        .map((skill) => path.join(plan.group.runtimeDir, skill)),
    );
    if (collisions.length > 0) {
      throw new SkillsManagerError('distribute_foreign_exists', `Refusing to overwrite unmanaged skill(s): ${collisions.join(', ')}`);
    }
  }

  /** Read the applied category set for one physical runtime dir; null when the path was never applied (ADR-0015). */
  readCategorySet(to: DistributionTargetKind, runtimeDir: string, projectRoot?: string): AppliedCategorySet | null {
    const target = this.resolveTarget(to, projectRoot);
    return this.loadRecord(target.id)?.categorySets?.[path.resolve(runtimeDir)] ?? null;
  }

  /** Record the applied category set for one physical runtime dir, persisting through the existing index write path. */
  recordCategorySet(to: DistributionTargetKind, runtimeDir: string, set: AppliedCategorySet, projectRoot?: string) {
    this.assertCategorySet(set);
    const target = this.resolveTarget(to, projectRoot);
    const key = path.resolve(runtimeDir);
    const record = this.loadRecord(target.id);
    this.rewriteRecord(target, record?.entries ?? [], { ...record?.categorySets, [key]: set });
  }

  /**
   * Report-only view of every known physical runtime path (ADR-0015): which
   * category set each path currently serves, and the drift an explicit apply
   * snapshot leaves behind — later tagging changes or installs never push into
   * the runtime, so status tells the operator when to re-run apply. Reads only.
   */
  categorySetStatus(): { paths: CategorySetStatusPath[] } {
    const paths = new Map<string, { agents: Set<string>; applied: AppliedCategorySet | null; live: Set<SkillName> }>();
    const getOrInit = (dir: string) => {
      let item = paths.get(dir);
      if (item === undefined) {
        item = { agents: new Set<string>(), applied: null, live: new Set<SkillName>() };
        paths.set(dir, item);
      }
      return item;
    };
    for (const record of this.loadIndex()) {
      for (const [dir, set] of Object.entries(record.categorySets ?? {})) {
        getOrInit(path.resolve(dir)).applied = set;
      }
      for (const entry of record.entries) {
        const item = getOrInit(path.resolve(path.dirname(entry.runtimePath)));
        entry.agents.forEach((id) => item.agents.add(id));
        if (this.fs.kind(entry.runtimePath) !== 'missing') item.live.add(entry.skill);
      }
    }
    return {
      paths: [...paths.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dir, { agents, applied, live }]) => ({
        runtimeDir: dir,
        agents: [...agents].sort(),
        applied,
        drift: applied === null ? [] : [...this.wantedSkills(applied)].filter((skill) => !live.has(skill)),
      })),
    };
  }

  /** Clear the applied category set for one physical runtime dir, leaving sibling paths' records untouched. */
  clearCategorySet(to: DistributionTargetKind, runtimeDir: string, projectRoot?: string) {
    const target = this.resolveTarget(to, projectRoot);
    const record = this.loadRecord(target.id);
    const key = path.resolve(runtimeDir);
    if (!record?.categorySets?.[key]) return;
    const { [key]: _dropped, ...rest } = record.categorySets;
    this.rewriteRecord(target, record.entries, rest);
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
    else this.rewriteRecord(target, [], {}); // restoring to a record-free state drops any category sets too
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

  /** Lay down one skill in one runtime group. Pure w.r.t. the index: the caller owns record persistence. */
  private applyOne(skill: SkillName, group: PhysicalGroup, mode: DistributeMode, fingerprint: string, appliedAt: string, force: boolean, existing: ReadonlyMap<string, DistributionIndexEntry>): DistributionIndexEntry {
    const runtimePath = path.join(group.runtimeDir, skill);
    this.fs.makeDirectory(group.runtimeDir);
    assertPathInside(runtimePath, group.runtimeDir);
    const kind = this.fs.kind(runtimePath);
    const prior = existing.get(applyEntryKey(skill, runtimePath));
    if (kind !== 'missing' && !prior && !force) {
      throw new SkillsManagerError('distribute_foreign_exists', `Refusing to overwrite unmanaged skill at ${runtimePath}`, { runtimePath, skill, agents: group.agents });
    }
    this.replacePath(runtimePath);
    const hubSkill = this.registry.skillDir(skill);
    if (mode === 'symlink') this.fs.symlink(hubSkill, runtimePath);
    else this.fs.copyDirectoryContents(hubSkill, runtimePath);
    const agents = [...new Set([...(prior?.agents || []), ...group.agents])].sort();
    return { skill, runtimePath, mode, fingerprint, managed: true, agents, appliedAt };
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

  /** Write one target's record, preserving whatever category sets the existing record carries. */
  private writeRecord(target: TargetRef, entries: DistributionIndexEntry[]) {
    const prior = this.loadRecord(target.id);
    this.rewriteRecord(target, entries, prior?.categorySets ?? {});
  }

  /** Write one target's record with explicit category sets — an empty object clears them. */
  private rewriteRecord(target: TargetRef, entries: DistributionIndexEntry[], categorySets: Record<string, AppliedCategorySet>) {
    const record: DistributionIndexRecord = {
      id: target.id,
      kind: target.kind,
      targetRoot: target.targetRoot,
      updatedAt: new Date().toISOString(),
      entries,
      ...(Object.keys(categorySets).length > 0 ? { categorySets } : {}),
    };
    this.replaceIndexRecord(record, entries.length === 0 && !record.categorySets);
  }

  private assertCategorySet(set: AppliedCategorySet) {
    const valid = 'all' in set
      ? set.all === true
      : Array.isArray(set.categories) && set.categories.length > 0 && set.categories.every((value) => typeof value === 'string' && value.trim().length > 0);
    if (!valid) {
      throw new SkillsManagerError('invalid_category_set', 'An applied category set is a non-empty category list or the { all: true } marker.');
    }
  }

  /** Marker equality: `--all` matches only itself; category lists compare element-wise. */
  private sameAppliedSet(a: AppliedCategorySet, b: AppliedCategorySet) {
    if ('all' in a || 'all' in b) return 'all' in a && 'all' in b;
    return a.categories.join('\n') === b.categories.join('\n');
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
    if (target.kind === 'user') {
      this.snapshot(target);
      this.pruneRestorePoints(target);
    }
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

  /** Keep only the newest restore points — older ones are states nobody rolls back to. */
  private pruneRestorePoints(target: TargetRef) {
    const root = this.backupRoot(target);
    if (this.fs.kind(root) !== 'directory') return;
    const dirs = this.fs.readDirectory(root)
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => entry.name)
      .sort(); // ISO-timestamped names sort chronologically
    for (const name of dirs.slice(0, Math.max(0, dirs.length - RESTORE_POINTS_KEPT))) {
      this.fs.removeTree(path.join(root, name));
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
