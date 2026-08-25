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

export type InitRunRequest = {
  /** Catalog agent ids to scan; omitted = the detected set on this machine. */
  agents?: readonly string[];
  /** Conflict decisions: skill -> agent id whose copy wins, or 'hub' to keep the hub copy. */
  resolve?: Readonly<Record<string, string>>;
  dryRun?: boolean;
  /** Skip every conflict instead of pausing on it (hub wins hub-vs-runtime clashes). */
  all?: boolean;
};

export type InitSkillLocation = {
  agentId: string;
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
};

export type InitRunResult = {
  dryRun: boolean;
  scanned: Array<{ agentId: string; runtimeDir: string }>;
  discovered: InitDiscoveredSkill[];
  imported: SkillName[];
  /** Origins already symlinked to the hub — nothing to do. */
  skippedManaged: SkillName[];
  conflicts: InitConflict[];
  failed: Array<{ skill: SkillName; reason: string }>;
};

type ScanGroup = {
  runtimeDir: string;
  agents: string[];
};

/**
 * Reverse of distribute (ADR-0006): fold skills already living in detected
 * agents' global runtime directories into the hub. Content moves into hub
 * `skills/<name>/`; each origin is preserved under hub `.backups/` and becomes
 * a managed symlink back to the hub entity.
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
  ) {}

  run(request: InitRunRequest = {}): InitRunResult {
    const agents = this.resolveAgents(request.agents);
    const groups = this.scanGroups(agents);
    const { skills: discovered, invalid } = this.discover(groups);

    // Classification is read-only, so dry-run reports the exact plan untouched.
    const imports: Array<{ skill: InitDiscoveredSkill; live: InitSkillLocation[]; choice: string | undefined }> = [];
    const skippedManaged = new Set<SkillName>();
    const conflicts: InitConflict[] = [];
    for (const skill of discovered) {
      const liveLocations = skill.locations.filter((location) => !this.isManagedSymlink(location.path, skill.name));
      if (liveLocations.length < skill.locations.length) skippedManaged.add(skill.name);
      if (liveLocations.length === 0) continue;

      const choice = request.resolve?.[skill.name];
      const hubHas = this.registry.skillExists(skill.name);
      if (!choice && (liveLocations.length > 1 || hubHas)) {
        conflicts.push({
          skill: skill.name,
          kind: liveLocations.length > 1 ? 'multi-runtime' : 'hub-vs-runtime',
          locations: liveLocations,
        });
        continue;
      }
      imports.push({ skill, live: liveLocations, choice });
    }

    const result: InitRunResult = {
      dryRun: Boolean(request.dryRun),
      scanned: groups.flatMap((group) => group.agents.map((agentId) => ({ agentId, runtimeDir: group.runtimeDir }))),
      discovered,
      imported: [],
      skippedManaged: [...skippedManaged],
      conflicts,
      failed: [...invalid],
    };
    if (request.dryRun) return result;

    this.skillHome.ensure();
    for (const item of imports) {
      try {
        this.importResolved(item.skill, item.live, item.choice);
        result.imported.push(item.skill.name);
      } catch (error) {
        result.failed.push({ skill: item.skill.name, reason: (error as Error).message });
      }
    }
    this.backups.prune();
    return result;
  }

  /**
   * Import one skill with its conflict decision applied. `choice` is an agent id
   * whose copy wins, or 'hub' to keep the hub copy and only back-symlink origins.
   */
  private importResolved(skill: InitDiscoveredSkill, live: InitSkillLocation[], choice: string | undefined) {
    assertSafeSkillName(skill.name);
    const hubHas = this.registry.skillExists(skill.name);
    const winner = choice && choice !== 'hub' ? this.locationForAgent(live, choice) : hubHas ? null : live[0];

    if (winner) {
      if (hubHas) {
        // The runtime copy wins: preserve the hub entity before it is replaced.
        this.fs.move(this.registry.skillDir(skill.name), this.backupDirFor(skill.name));
      }
      const hubDir = this.registry.skillDir(skill.name);
      this.fs.copyDirectoryContents(winner.path, hubDir);
      this.registry.ensureEntry(skill.name, {
        imported: true,
        imported_at: new Date().toISOString(),
        title: skill.title,
        description: skill.description,
        // Every origin's agents are this skill's desired consumers (catalog ids only).
        consumers: this.agentsForLocations(live),
      });
    }
    // Move = backup + vacate in one step; the symlink takes each origin's place.
    for (const location of live) this.fs.move(location.path, this.backupDirFor(skill.name));
    this.distribute.apply({ to: 'user', skills: [skill.name], agents: this.agentsForLocations(live), mode: 'symlink' });
  }

  private locationForAgent(live: InitSkillLocation[], agentId: string) {
    const found = live.find((location) => this.agentsForDir(location.runtimeDir).includes(agentId));
    if (!found) {
      throw new SkillsManagerError('init_unknown_resolution', `Resolution "${agentId}" for skill "${live[0] ? this.skillNameOf(live[0]) : '?'}" matches none of the clashing locations. Pick one of the reported agent ids or 'hub'.`);
    }
    return found;
  }

  private skillNameOf(location: InitSkillLocation) {
    return path.basename(location.path);
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
        const location: InitSkillLocation = { agentId: group.agents[0], runtimeDir: group.runtimeDir, path: skillDir };
        const existing = byName.get(name);
        if (existing) byName.set(name, { ...existing, locations: [...existing.locations, location] });
        else byName.set(name, { name, title, description, locations: [location] });
      }
    }
    return { skills: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)), invalid };
  }
}
