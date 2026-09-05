import path from 'node:path';
import type { SkillHome, SkillName } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertSafeSkillName, parseSkillMarkdownMetadata } from '../../shared/validation.js';
import type { CatalogService } from './catalog-service.js';
import type { DistributeService } from './distribute-service.js';
import type { RegistryService } from './registry-service.js';
import type { SkillHomeService } from './skill-home-service.js';
import type { BackupService } from './backup-service.js';
import { lockEntryToSource, type SkillLockEntry, type SkillLockService } from './skill-lock-service.js';

export type InitRunRequest = {
  /** Catalog agent ids to scan; omitted = the detected set on this machine. */
  agents?: readonly string[];
  /** Conflict decisions: skill -> runtime dir (or any agent id sharing it) whose copy wins, or 'hub' to keep the hub copy. */
  resolve?: Readonly<Record<string, string>>;
  /** Per-import conflict priority: ordered runtime dirs, agent ids, or 'hub'. */
  prefer?: readonly string[];
  dryRun?: boolean;
};

export type InitSkillLocation = {
  /** Every catalog agent sharing the runtime dir — a dir is the identity, not one agent. */
  agentIds: string[];
  runtimeDir: string;
  /** The physical skill directory inside the agent's global runtime dir. */
  path: string;
};

export type InitDiscoveredSkill = {
  name: SkillName;
  title: string;
  description: string;
  locations: InitSkillLocation[];
};

export type InitConflict = {
  skill: SkillName;
  kind: 'multi-runtime' | 'hub-vs-runtime';
  locations: InitSkillLocation[];
  /** True when the hub already holds this skill — `hub` is a valid choice. */
  hub: boolean;
};

export type InitRunResult = {
  dryRun: boolean;
  scanned: Array<{ agentId: string; runtimeDir: string }>;
  discovered: InitDiscoveredSkill[];
  imported: SkillName[];
  /** Winner for each imported skill: `hub` or the winning runtime dir. */
  choices: Record<string, string>;
  /** Origins already symlinked to the hub — nothing to do. */
  skippedManaged: SkillName[];
  conflicts: InitConflict[];
  failed: Array<{ skill: SkillName; reason: string }>;
};

type ScanGroup = {
  runtimeDir: string;
  agents: string[];
};

/** Locations whose paths resolve to the same physical directory — one origin, not a clash. */
type EntityGroup = InitSkillLocation[];

/**
 * Reverse of distribute (ADR-0006): fold skills already living in detected
 * agents' global runtime directories into the hub. Content moves into hub
 * `skills/<name>/`; each origin is preserved under hub `.backups/` and becomes
 * a managed symlink back to the hub entity. Provenance: no guessed sources,
 * but `npx skills` lockfile evidence is adopted when present (ADR-0011).
 */
export class InitService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly skillHome: SkillHomeService,
    private readonly registry: RegistryService,
    private readonly distribute: DistributeService,
    private readonly catalog: CatalogService,
    private readonly backups: BackupService,
    private readonly skillLock: SkillLockService,
  ) {}

  run(request: InitRunRequest = {}): InitRunResult {
    const agents = this.resolveAgents(request.agents);
    const scans = this.scanGroups(agents);
    this.assertPrefer(request.prefer, scans.map((scan) => scan.runtimeDir));
    const { skills: discovered, invalid } = this.discover(scans);
    // Import evidence is read once per run; read-only, and absent locks cost nothing.
    const lockEntries = this.skillLock.load();

    // Classification is read-only, so dry-run reports the exact plan untouched.
    const imports: Array<{ skill: InitDiscoveredSkill; groups: EntityGroup[]; choice: string | undefined }> = [];
    const skippedManaged = new Set<SkillName>();
    const conflicts: InitConflict[] = [];
    const scannedDirs = new Set(scans.map((scan) => scan.runtimeDir));
    for (const skill of discovered) {
      const liveLocations = skill.locations.filter((location) => !this.isManagedSymlink(location.path, skill.name));
      if (liveLocations.length < skill.locations.length) skippedManaged.add(skill.name);
      if (liveLocations.length === 0) continue;

      // Same physical path, then same full-tree fingerprint, are one entity — not a clash.
      const groups = this.mergeIdentical(this.groupByEntity(liveLocations));
      const hubHas = this.registry.skillExists(skill.name);
      const hubFp = hubHas ? this.distribute.fingerprint(skill.name) : null;
      const competing = hubFp ? groups.filter((group) => this.groupFingerprint(group) !== hubFp) : groups;
      const needsDecision = competing.length > 1 || (hubHas && competing.length >= 1);
      const choice = request.resolve?.[skill.name] ?? (needsDecision ? this.pickPrefer(request.prefer, groups, skill.name, hubHas, scannedDirs) : undefined);
      if (needsDecision && !choice) {
        conflicts.push({
          skill: skill.name,
          kind: competing.length > 1 ? 'multi-runtime' : 'hub-vs-runtime',
          locations: competing.map((group) => group[0]),
          hub: hubHas,
        });
        continue;
      }
      const implicit = !choice && hubHas && competing.length === 0 ? 'hub' : choice;
      imports.push({ skill, groups, choice: implicit });
    }

    const result: InitRunResult = {
      dryRun: Boolean(request.dryRun),
      scanned: scans.flatMap((scan) => scan.agents.map((agentId) => ({ agentId, runtimeDir: scan.runtimeDir }))),
      discovered,
      imported: [],
      choices: {},
      skippedManaged: [...skippedManaged],
      conflicts,
      failed: [...invalid],
    };
    for (const item of imports) {
      result.choices[item.skill.name] = this.winnerKey(item.groups, item.choice);
    }
    if (request.dryRun) {
      result.imported = imports.map((item) => item.skill.name);
      return result;
    }

    this.skillHome.ensure();
    for (const item of imports) {
      try {
        this.importResolved(item.skill, item.groups, item.choice, lockEntries);
        result.imported.push(item.skill.name);
      } catch (error) {
        result.failed.push({ skill: item.skill.name, reason: (error as Error).message });
        result.choices = Object.fromEntries(Object.entries(result.choices).filter(([name]) => name !== item.skill.name));
      }
    }
    this.backups.prune();
    return result;
  }

  /**
   * Import one skill with its conflict decision applied. `choice` is a runtime
   * dir (or any agent id sharing it) whose copy wins, or 'hub' to keep the hub
   * copy and only back-symlink origins. Lock evidence (when the skill name
   * matches an `npx skills` entry) upgrades the import from snapshot to
   * update-managed in the same write (ADR-0011).
   */
  private importResolved(skill: InitDiscoveredSkill, groups: EntityGroup[], choice: string | undefined, lockEntries: ReadonlyMap<SkillName, SkillLockEntry>) {
    assertSafeSkillName(skill.name);
    const hubHas = this.registry.skillExists(skill.name);
    const winnerGroup = choice && choice !== 'hub' ? this.groupForChoice(groups, choice, skill.name) : hubHas ? null : groups[0];
    const locations = groups.flat();

    if (winnerGroup) {
      if (hubHas) {
        // The runtime copy wins: preserve the hub entity before it is replaced.
        this.fs.move(this.registry.skillDir(skill.name), this.backupDirFor(skill.name));
      }
      const hubDir = this.registry.skillDir(skill.name);
      // Copy through symlinks: the hub needs the entity's contents, not a link to it.
      this.fs.copyDirectoryContents(this.entityPathOf(winnerGroup[0].path), hubDir);
      const evidence = lockEntryToSource(lockEntries.get(skill.name));
      this.registry.ensureEntry(skill.name, {
        imported: true,
        imported_at: new Date().toISOString(),
        title: skill.title,
        description: skill.description,
        // Every origin's agents are this skill's desired consumers (catalog ids only).
        consumers: this.agentsForLocations(locations),
        // Adopted evidence replaces the default source-less shape; no evidence keeps the snapshot honest.
        ...(evidence ? { source: evidence } : {}),
      });
    }
    // Real directories are preserved as backups and vacated; symlinked entries are
    // simply removed — distribute lays a managed symlink down in every origin's place.
    for (const location of locations) {
      if (this.fs.kind(location.path) === 'symlink') this.fs.removeFileOrSymlink(location.path);
      else this.fs.move(location.path, this.backupDirFor(skill.name));
    }
    this.distribute.apply({ to: 'user', skills: [skill.name], agents: this.agentsForLocations(locations), mode: 'symlink' });
  }

  private assertPrefer(prefer: readonly string[] | undefined, scannedDirs: readonly string[]) {
    if (!prefer || prefer.length === 0) return;
    const dirs = new Set(scannedDirs);
    for (const item of prefer) this.resolvePreferItem(item, dirs);
  }

  private resolvePreferItem(item: string, scannedDirs: Set<string>): string {
    if (item === 'hub') return 'hub';
    if (scannedDirs.has(item)) return item;
    const resolvedPath = path.resolve(item);
    if (scannedDirs.has(resolvedPath)) return resolvedPath;
    const fromAgent = this.catalog.resolveGlobalDir(item);
    if (fromAgent && scannedDirs.has(fromAgent)) return fromAgent;
    throw new SkillsManagerError(
      'init_unknown_prefer',
      `Prefer item "${item}" is not hub and does not resolve to a runtime directory scanned this run.`,
    );
  }

  private pickPrefer(prefer: readonly string[] | undefined, groups: EntityGroup[], skill: SkillName, hubHas: boolean, scannedDirs: Set<string>): string | undefined {
    if (!prefer || prefer.length === 0) return undefined;
    const hubFp = hubHas ? this.distribute.fingerprint(skill) : null;
    for (const item of prefer) {
      const key = this.resolvePreferItem(item, scannedDirs);
      if (key === 'hub') {
        if (hubHas) return 'hub';
        continue;
      }
      const found = groups.find((group) => group.some((location) => location.runtimeDir === key || location.agentIds.includes(item)));
      if (!found) continue;
      if (hubFp && this.groupFingerprint(found) === hubFp) return 'hub';
      return found[0].runtimeDir;
    }
    return undefined;
  }

  private mergeIdentical(groups: EntityGroup[]): EntityGroup[] {
    return groups.reduce<EntityGroup[]>((merged, group) => {
      const fingerprint = this.groupFingerprint(group);
      const index = merged.findIndex((item) => this.groupFingerprint(item) === fingerprint);
      return index === -1 ? [...merged, group] : merged.map((item, i) => (i === index ? [...item, ...group] : item));
    }, []);
  }

  private groupFingerprint(group: EntityGroup) {
    return this.distribute.fingerprintDir(this.entityPathOf(group[0].path));
  }

  private winnerKey(groups: EntityGroup[], choice: string | undefined) {
    if (choice === 'hub' || (!choice && groups.length === 0)) return 'hub';
    if (choice && choice !== 'hub') {
      const found = groups.find((group) => group.some((location) => location.runtimeDir === choice || location.agentIds.includes(choice)));
      return found ? found[0].runtimeDir : choice;
    }
    return groups[0][0].runtimeDir;
  }

  private groupForChoice(groups: EntityGroup[], choice: string, skill: SkillName) {
    const found = groups.find((group) => group.some((location) => location.runtimeDir === choice || location.agentIds.includes(choice)));
    if (!found) {
      throw new SkillsManagerError('init_unknown_resolution', `Resolution "${choice}" for skill "${skill}" matches none of the clashing locations. Pick a reported runtime dir (or one of its agent ids) or 'hub'.`);
    }
    return found;
  }

  /** Group locations by the physical directory they resolve to through symlink chains. */
  private groupByEntity(locations: InitSkillLocation[]): EntityGroup[] {
    return locations.reduce<EntityGroup[]>((groups, location) => {
      const entity = this.entityPathOf(location.path);
      const index = groups.findIndex((group) => this.entityPathOf(group[0].path) === entity);
      return index === -1
        ? [...groups, [location]]
        : groups.map((group, i) => (i === index ? [...group, location] : group));
    }, []);
  }

  /** Follow symlink chains (bounded — a loop must not hang import) to the physical path. */
  private entityPathOf(locationPath: string): string {
    let current = locationPath;
    for (let hops = 0; this.fs.kind(current) === 'symlink' && hops < 8; hops += 1) {
      current = path.resolve(path.dirname(current), this.fs.readlink(current));
    }
    return current;
  }

  private agentsForLocations(live: InitSkillLocation[]) {
    return [...new Set(live.flatMap((location) => this.agentsForDir(location.runtimeDir)))].sort();
  }

  /** A runtime path already pointing at this hub skill is managed — leave it alone. */
  private isManagedSymlink(runtimePath: string, skill: SkillName) {
    if (this.fs.kind(runtimePath) !== 'symlink') return false;
    return path.resolve(this.fs.readlink(runtimePath)) === path.resolve(this.registry.skillDir(skill));
  }

  private backupDirFor(skill: SkillName) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = path.join(this.home.root, '.backups', `${skill}-${timestamp}`);
    let dir = base;
    for (let n = 2; this.fs.exists(dir); n += 1) dir = `${base}-${n}`;
    return dir;
  }

  private agentsForDir(runtimeDir: string) {
    const resolved = new Set<string>();
    for (const agent of this.catalog.load().agents) {
      if (!agent.globalSkillsDir) continue;
      if (this.catalog.resolveGlobalDir(agent.id) === runtimeDir) resolved.add(agent.id);
    }
    return [...resolved].sort();
  }

  private resolveAgents(requested: readonly string[] | undefined): string[] {
    const ids = requested !== undefined ? [...new Set(requested)].sort() : this.catalog.detected();
    if (ids.length === 0) {
      throw new SkillsManagerError('init_no_agents', 'No agents selected and none detected on this machine. Pass --agent <id...>; run `skills-manager catalog info` to see the catalog.');
    }
    const known = new Set(this.catalog.load().agents.map((agent) => agent.id));
    const invalid = ids.filter((id) => !known.has(id));
    if (invalid.length > 0) {
      throw new SkillsManagerError('init_unknown_agent', `Unknown agent id(s): ${invalid.join(', ')}. Run \`skills-manager catalog info\` to list valid catalog ids.`);
    }
    return ids;
  }

  /** Resolve agent ids into deduplicated physical runtime dirs, one scan each. */
  private scanGroups(agentIds: readonly string[]): ScanGroup[] {
    const byDir = new Map<string, string[]>();
    for (const id of agentIds) {
      const resolved = this.catalog.resolveGlobalDir(id);
      if (resolved === null) continue; // project-only agents have nothing global to scan
      const members = byDir.get(resolved) || [];
      byDir.set(resolved, [...members, id]);
    }
    return [...byDir.entries()].map(([runtimeDir, agents]) => ({ runtimeDir, agents: agents.sort() }));
  }

  /** One level under each runtime dir: `<dir>/<name>/SKILL.md` is a skill. */
  private discover(groups: ScanGroup[]): { skills: InitDiscoveredSkill[]; invalid: Array<{ skill: string; reason: string }> } {
    const byName = new Map<SkillName, InitDiscoveredSkill>();
    const invalid: Array<{ skill: string; reason: string }> = [];
    for (const group of groups) {
      if (this.fs.kind(group.runtimeDir) !== 'directory') continue;
      for (const entry of this.fs.readDirectory(group.runtimeDir)) {
        // Symlinked entries are still candidates: an origin init already manages
        // is one, and a user-made link may hold a real SKILL.md behind it.
        if ((entry.kind !== 'directory' && entry.kind !== 'symlink') || entry.name.startsWith('.')) continue;
        const skillDir = path.join(group.runtimeDir, entry.name);
        const skillFile = path.join(skillDir, 'SKILL.md');
        if (this.fs.kind(skillFile) !== 'file') continue;
        let name: string;
        let title: string;
        let description: string;
        try {
          const metadata = parseSkillMarkdownMetadata(this.fs.readText(skillFile));
          name = String(metadata.name || entry.name).trim();
          title = String(metadata.title || name);
          description = String(metadata.description || '');
        } catch (error) {
          // An unusable SKILL.md fails this one directory, never the whole scan.
          invalid.push({ skill: entry.name, reason: (error as Error).message });
          continue;
        }
        const location: InitSkillLocation = { agentIds: group.agents, runtimeDir: group.runtimeDir, path: skillDir };
        const existing = byName.get(name);
        if (existing) byName.set(name, { ...existing, locations: [...existing.locations, location] });
        else byName.set(name, { name, title, description, locations: [location] });
      }
    }
    return { skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), invalid };
  }
}
