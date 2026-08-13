import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  CONSUMERS,
  type Consumer,
  type DistributeMode,
  type DistributionHealth,
  type DistributionIndexEntry,
  type DistributionIndexRecord,
  type DistributionTargetKind,
  type SkillHome,
  type SkillName,
} from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName, parseConsumers } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';

export type DistributeRequest = {
  to: DistributionTargetKind;
  projectRoot?: string;
  skills: readonly string[];
  consumers: readonly string[];
  mode?: DistributeMode;
  force?: boolean;
};

type TargetRef = {
  kind: DistributionTargetKind;
  targetRoot: string;
  id: string;
};

type ReceiptFile = {
  version: number;
  hubRoot: string;
  updatedAt: string;
  skills: Record<string, Partial<Record<Consumer, { mode: DistributeMode; fingerprint: string; appliedAt: string }>>>;
};

type SnapshotManifest = {
  kind: DistributionTargetKind;
  targetRoot: string;
  record: DistributionIndexRecord | null;
  receipt: ReceiptFile | null;
};

export class DistributeService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly userHome: string = os.homedir(),
  ) {}

  apply(request: DistributeRequest) {
    const target = this.resolveTarget(request.to, request.projectRoot);
    const consumers = parseConsumers(request.consumers);
    const skills = this.requireCanonicalSkills(request.skills);
    const mode = request.mode ?? (request.to === 'user' ? 'symlink' : 'copy');
    this.assertMode(mode);
    this.snapshot(target);
    const appliedAt = new Date().toISOString();
    const entries: DistributionIndexEntry[] = [];
    for (const skill of skills) {
      const fingerprint = this.fingerprint(skill);
      for (const consumer of consumers) {
        entries.push(this.applyOne(target, skill, consumer, mode, fingerprint, appliedAt, Boolean(request.force)));
      }
    }
    return { target, mode, entries };
  }

  undistribute(request: Omit<DistributeRequest, 'mode' | 'force'>) {
    const target = this.resolveTarget(request.to, request.projectRoot);
    const consumers = parseConsumers(request.consumers);
    const skills = [...request.skills];
    for (const skill of skills) assertSafeSkillName(skill);
    this.snapshot(target);
    const record = this.loadRecord(target.id);
    const removed: DistributionIndexEntry[] = [];
    for (const skill of skills) {
      for (const consumer of consumers) {
        const entry = record?.entries.find((item) => item.skill === skill && item.consumer === consumer);
        if (!entry) continue;
        this.removeManagedPath(entry.runtimePath);
        removed.push(entry);
      }
    }
    this.writeRecord(target, (record?.entries || []).filter((entry) => !removed.some((item) => item.skill === entry.skill && item.consumer === entry.consumer)));
    if (target.kind === 'project') this.syncReceiptFromRecord(target);
    return { target, removed };
  }

  redistributeOutdated(filter: { to?: DistributionTargetKind; projectRoot?: string; force?: boolean } = {}) {
    const records = this.loadIndex().filter((record) => {
      if (filter.to && record.kind !== filter.to) return false;
      if (filter.projectRoot && path.resolve(filter.projectRoot) !== path.resolve(record.targetRoot)) return false;
      return true;
    });
    const refreshed: DistributionIndexEntry[] = [];
    for (const record of records) {
      const outdated = record.entries.filter((entry) => this.entryOutdated(entry));
      for (const entry of outdated) {
        const result = this.apply({
          to: record.kind,
          projectRoot: record.kind === 'project' ? record.targetRoot : undefined,
          skills: [entry.skill],
          consumers: [entry.consumer],
          mode: entry.mode,
          force: filter.force,
        });
        refreshed.push(...result.entries);
      }
    }
    return { refreshed };
  }

  rollback(to: DistributionTargetKind, projectRoot?: string) {
    const target = this.resolveTarget(to, projectRoot);
    const latest = this.latestBackupDir(target);
    if (!latest) throw new SkillsManagerError('distribute_no_rollback', `No restore point for ${target.id}`);
    const manifest = YAML.parse(this.fs.readText(path.join(latest, 'manifest.yaml'))) as SnapshotManifest;
    const current = this.loadRecord(target.id);
    for (const entry of current?.entries || []) this.removeManagedPath(entry.runtimePath);
    const trees = path.join(latest, 'trees');
    if (this.fs.kind(trees) === 'directory') {
      for (const consumerEntry of this.fs.readDirectory(trees)) {
        const consumerDir = path.join(trees, consumerEntry.name);
        if (consumerEntry.kind !== 'directory') continue;
        for (const skillEntry of this.fs.readDirectory(consumerDir)) {
          const source = path.join(consumerDir, skillEntry.name);
          const dest = this.runtimeSkillPath(target, consumerEntry.name as Consumer, skillEntry.name);
          this.fs.makeDirectory(path.dirname(dest));
          this.replacePath(dest);
          if (skillEntry.kind === 'symlink') this.fs.symlink(this.fs.readlink(source), dest);
          else if (skillEntry.kind === 'directory') this.fs.copyDirectoryContents(source, dest);
        }
      }
    }
    if (manifest.record) this.replaceIndexRecord(manifest.record);
    else this.writeRecord(target, []);
    if (target.kind === 'project') {
      if (manifest.receipt) this.fs.writeText(this.receiptPath(target.targetRoot), YAML.stringify(manifest.receipt, { lineWidth: 0 }));
      else if (this.fs.exists(this.receiptPath(target.targetRoot))) this.fs.removeFileOrSymlink(this.receiptPath(target.targetRoot));
    }
    return { target, restoredFrom: latest };
  }

  migrateViews(options: { deleteViews?: boolean; force?: boolean } = {}) {
    const skipped: string[] = [];
    const distributed: string[] = [];
    for (const consumer of CONSUMERS) {
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
          this.apply({ to: 'user', skills: [skill], consumers: [consumer], force: options.force });
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
    let agents = 0;
    let claude = 0;
    let outdated = 0;
    for (const record of records) {
      for (const entry of record.entries) {
        if (this.fs.kind(entry.runtimePath) === 'missing') continue;
        if (entry.consumer === 'agents') agents += 1;
        if (entry.consumer === 'claude') claude += 1;
        if (this.entryOutdated(entry)) outdated += 1;
      }
    }
    return {
      agents,
      claude,
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
          warnings.push(`Distributed skill is archived on the hub: ${entry.skill} (${record.kind} ${entry.consumer})`);
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
    const root = this.registry.skillDir(skill);
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

  private applyOne(target: TargetRef, skill: SkillName, consumer: Consumer, mode: DistributeMode, fingerprint: string, appliedAt: string, force: boolean): DistributionIndexEntry {
    const runtimePath = this.runtimeSkillPath(target, consumer, skill);
    const consumerRoot = path.dirname(runtimePath);
    this.fs.makeDirectory(consumerRoot);
    assertPathInside(runtimePath, consumerRoot);
    const kind = this.fs.kind(runtimePath);
    const managed = this.isManaged(target, skill, consumer);
    if (kind !== 'missing' && !managed && !force) {
      throw new SkillsManagerError('distribute_foreign_exists', `Refusing to overwrite unmanaged skill at ${runtimePath}`, { runtimePath, skill, consumer });
    }
    this.replacePath(runtimePath);
    const hubSkill = this.registry.skillDir(skill);
    if (mode === 'symlink') this.fs.symlink(hubSkill, runtimePath);
    else this.fs.copyDirectoryContents(hubSkill, runtimePath);
    const entry: DistributionIndexEntry = { skill, consumer, mode, fingerprint, runtimePath };
    const record = this.loadRecord(target.id);
    const next = [...(record?.entries || []).filter((item) => !(item.skill === skill && item.consumer === consumer)), entry];
    this.writeRecord(target, next);
    if (target.kind === 'project') this.upsertReceipt(target, skill, consumer, mode, fingerprint, appliedAt);
    return entry;
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

  private runtimeSkillPath(target: TargetRef, consumer: Consumer, skill: string) {
    const base = path.join(target.targetRoot, `.${consumer}`, 'skills', skill);
    try {
      assertPathInside(base, path.join(target.targetRoot, `.${consumer}`, 'skills'));
    } catch {
      throw new SkillsManagerError('distribute_path_escape', `Runtime path escaped consumer skill dir: ${base}`);
    }
    return base;
  }

  private assertMode(mode: DistributeMode) {
    if (mode !== 'symlink' && mode !== 'copy') throw new SkillsManagerError('invalid_distribute_mode', `Unknown mode: ${mode}`);
  }

  private isManaged(target: TargetRef, skill: string, consumer: Consumer) {
    const record = this.loadRecord(target.id);
    const entry = record?.entries.find((item) => item.skill === skill && item.consumer === consumer);
    if (!entry) return false;
    const kind = this.fs.kind(entry.runtimePath);
    return kind === 'symlink' || kind === 'directory' || kind === 'file';
  }

  private entryOutdated(entry: DistributionIndexEntry) {
    if (!this.registry.skillExists(entry.skill)) return false;
    return entry.fingerprint !== this.fingerprint(entry.skill);
  }

  private loadIndex(): DistributionIndexRecord[] {
    if (this.fs.kind(this.indexPath()) !== 'file') return [];
    return this.fs.readText(this.indexPath())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as DistributionIndexRecord);
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
    this.replaceIndexRecord(entries.length === 0 ? { ...record, entries: [] } : record, entries.length === 0);
  }

  private replaceIndexRecord(record: DistributionIndexRecord, drop = false) {
    const next = this.loadIndex().filter((item) => item.id !== record.id);
    if (!drop) next.push(record);
    this.fs.makeDirectory(path.dirname(this.indexPath()));
    this.fs.writeText(this.indexPath(), next.map((item) => JSON.stringify(item)).join('\n') + (next.length ? '\n' : ''));
  }

  private receiptPath(projectRoot: string) {
    return path.join(projectRoot, '.skills-manager', 'distribute.yaml');
  }

  private loadReceipt(projectRoot: string): ReceiptFile | null {
    const file = this.receiptPath(projectRoot);
    if (this.fs.kind(file) !== 'file') return null;
    const parsed = YAML.parse(this.fs.readText(file)) as ReceiptFile;
    if (!parsed || parsed.version !== 1) throw new SkillsManagerError('distribute_unknown_receipt_version', `Unsupported receipt version in ${file}`);
    return parsed;
  }

  private upsertReceipt(target: TargetRef, skill: string, consumer: Consumer, mode: DistributeMode, fingerprint: string, appliedAt: string) {
    const current = this.loadReceipt(target.targetRoot) || { version: 1, hubRoot: this.home.root, updatedAt: appliedAt, skills: {} };
    current.hubRoot = this.home.root;
    current.updatedAt = appliedAt;
    current.skills[skill] = { ...(current.skills[skill] || {}), [consumer]: { mode, fingerprint, appliedAt } };
    this.fs.makeDirectory(path.dirname(this.receiptPath(target.targetRoot)));
    this.fs.writeText(this.receiptPath(target.targetRoot), YAML.stringify(current, { lineWidth: 0 }));
  }

  private syncReceiptFromRecord(target: TargetRef) {
    const record = this.loadRecord(target.id);
    if (!record || record.entries.length === 0) {
      if (this.fs.exists(this.receiptPath(target.targetRoot))) this.fs.removeFileOrSymlink(this.receiptPath(target.targetRoot));
      return;
    }
    const skills: ReceiptFile['skills'] = {};
    for (const entry of record.entries) {
      skills[entry.skill] = {
        ...(skills[entry.skill] || {}),
        [entry.consumer]: { mode: entry.mode, fingerprint: entry.fingerprint, appliedAt: record.updatedAt },
      };
    }
    const receipt: ReceiptFile = { version: 1, hubRoot: this.home.root, updatedAt: record.updatedAt, skills };
    this.fs.makeDirectory(path.dirname(this.receiptPath(target.targetRoot)));
    this.fs.writeText(this.receiptPath(target.targetRoot), YAML.stringify(receipt, { lineWidth: 0 }));
  }

  private backupRoot(target: TargetRef) {
    if (target.kind === 'user') return path.join(this.home.root, '.skills', 'distribute-backups', this.safeId(target.id));
    return path.join(target.targetRoot, '.skills-manager', 'backups');
  }

  private safeId(id: string) {
    return id.replace(/[^A-Za-z0-9._-]+/g, '_');
  }

  private snapshot(target: TargetRef) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(this.backupRoot(target), timestamp);
    this.fs.makeDirectory(dir);
    const record = this.loadRecord(target.id);
    const receipt = target.kind === 'project' ? this.safeLoadReceipt(target.targetRoot) : null;
    this.fs.writeText(path.join(dir, 'manifest.yaml'), YAML.stringify({ kind: target.kind, targetRoot: target.targetRoot, record, receipt } satisfies SnapshotManifest, { lineWidth: 0 }));
    const trees = path.join(dir, 'trees');
    for (const entry of record?.entries || []) {
      if (this.fs.kind(entry.runtimePath) === 'missing') continue;
      const dest = path.join(trees, entry.consumer, entry.skill);
      this.fs.makeDirectory(path.dirname(dest));
      const kind = this.fs.kind(entry.runtimePath);
      if (kind === 'symlink') this.fs.symlink(this.fs.readlink(entry.runtimePath), dest);
      else if (kind === 'directory') this.fs.copyDirectoryContents(entry.runtimePath, dest);
    }
  }

  private safeLoadReceipt(projectRoot: string) {
    try {
      return this.loadReceipt(projectRoot);
    } catch {
      return null;
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
    for (const consumer of CONSUMERS) {
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
    const roots = new Set<string>();
    roots.add(path.join(this.userHome, '.agents', 'skills'));
    roots.add(path.join(this.userHome, '.claude', 'skills'));
    for (const record of records) {
      if (record.kind !== 'project') continue;
      roots.add(path.join(record.targetRoot, '.agents', 'skills'));
      roots.add(path.join(record.targetRoot, '.claude', 'skills'));
    }
    let foreign = 0;
    for (const root of roots) {
      if (this.fs.kind(root) !== 'directory') continue;
      for (const entry of this.fs.readDirectory(root)) {
        const full = path.join(root, entry.name);
        if (!managed.has(full)) foreign += 1;
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
