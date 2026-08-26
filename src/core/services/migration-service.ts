import path from 'node:path';
import YAML from 'yaml';
import type { SkillHome } from '../model/index.js';
import type { CatalogService } from './catalog-service.js';
import type { DistributeService } from './distribute-service.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { isLegacyConsumer } from '../../shared/validation.js';
import { type DistributionIndexEntry, type DistributionIndexRecord } from '../model/index.js';

/** Legacy one-shot bridge (ADR-0004): rewrite registry tags and the hub index onto catalog ids. No translation code survives it. */

type LegacyIndexEntry = { skill: string; consumer: string; mode: 'symlink' | 'copy'; fingerprint: string; runtimePath: string };
type LegacyRecord = { id: string; kind: 'user' | 'project'; targetRoot: string; updatedAt: string; entries: LegacyIndexEntry[] };

export type MigrationPlan = {
  agentMapping: Record<string, string[]>;
  registryChanges: Array<{ skill: string; from: string[]; to: string[] }>;
  indexEntries: number;
};

export type MigrationResult = {
  migrated: { registrySkills: string[]; indexEntries: number };
  backupDir: string;
};

export class MigrationService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly distribute: DistributeService,
    private readonly catalog: CatalogService,
  ) {}

  /** Identity-preserving mapping: claude → claude-code; agents → the ~/.agents/skills global family. */
  agentMapping(): Record<string, string[]> {
    const family = this.catalog.load().agents.filter((agent) => agent.globalSkillsDir === '~/.agents/skills').map((agent) => agent.id).sort();
    return { claude: ['claude-code'], agents: family };
  }

  plan(): MigrationPlan {
    const mapping = this.agentMapping();
    const registryChanges: MigrationPlan['registryChanges'] = [];
    for (const [skill, entry] of Object.entries(this.readRawRegistry())) {
      const consumers = (entry.consumers || []) as string[];
      const legacy = consumers.filter((value) => isLegacyConsumer(value));
      if (legacy.length === 0) continue;
      const to = [...new Set(consumers.flatMap((value) => (isLegacyConsumer(value) ? mapping[value] : [value])))].sort();
      registryChanges.push({ skill, from: consumers, to });
    }
    const records = this.readRawIndex();
    return { agentMapping: mapping, registryChanges, indexEntries: records.reduce((count, record) => count + record.entries.filter((entry) => isLegacyConsumer(entry.consumer)).length, 0) };
  }

  apply(): MigrationResult {
    const plan = this.plan();
    const mapping = this.agentMapping();
    const backupDir = path.join(this.home.root, '.skills', 'migrate-consumers-backup', new Date().toISOString().replace(/[:.]/g, '-'));
    this.fs.makeDirectory(backupDir);

    // 1. Registry: expand legacy tags in place (raw read — the loader hard-fails on them by design).
    const rawRegistry = this.readRawRegistry();
    const registrySkills: string[] = [];
    for (const change of plan.registryChanges) {
      const entry = rawRegistry[change.skill];
      entry.consumers = change.to;
      registrySkills.push(change.skill);
    }
    this.fs.writeText(path.join(backupDir, 'registry.yaml'), this.fs.readText(this.home.registryFile));
    this.fs.writeText(this.home.registryFile, YAML.stringify({ skills: rawRegistry }, { lineWidth: 0 }));

    // 2. Hub index: v1 consumer entries → v2 dual-layer entries (identical runtimePath).
    const records = this.readRawIndex();
    let indexEntries = 0;
    const migratedRecords: DistributionIndexRecord[] = records.map((record) => ({
      ...record,
      entries: record.entries.map((entry): DistributionIndexEntry => {
        if (!isLegacyConsumer(entry.consumer)) {
          return entry as unknown as DistributionIndexEntry;
        }
        indexEntries += 1;
        return {
          skill: entry.skill,
          runtimePath: entry.runtimePath,
          mode: entry.mode,
          fingerprint: entry.fingerprint,
          managed: true,
          agents: mapping[entry.consumer],
          appliedAt: record.updatedAt,
        };
      }),
    }));
    this.fs.writeText(path.join(backupDir, 'distributions.jsonl'), this.fs.readText(this.distribute.indexPath()));
    this.fs.writeText(this.distribute.indexPath(), migratedRecords.map((record) => JSON.stringify(record)).join('\n') + (migratedRecords.length ? '\n' : ''));

    return { migrated: { registrySkills, indexEntries }, backupDir };
  }

  rollback() {
    const root = path.join(this.home.root, '.skills', 'migrate-consumers-backup');
    if (this.fs.kind(root) !== 'directory') throw new SkillsManagerError('migrate_no_backup', `No migrate-consumers backup found under ${root}`);
    const latest = this.fs.readDirectory(root).filter((entry) => entry.kind === 'directory').map((entry) => entry.name).sort().pop();
    if (!latest) throw new SkillsManagerError('migrate_no_backup', `No migrate-consumers backup found under ${root}`);
    const dir = path.join(root, latest);
    this.fs.writeText(this.home.registryFile, this.fs.readText(path.join(dir, 'registry.yaml')));
    this.fs.writeText(this.distribute.indexPath(), this.fs.readText(path.join(dir, 'distributions.jsonl')));
  }

  private readRawRegistry(): Record<string, { consumers?: string[]; [key: string]: unknown }> {
    if (!this.fs.exists(this.home.registryFile)) return {};
    const parsed = YAML.parse(this.fs.readText(this.home.registryFile)) as { skills?: Record<string, { consumers?: string[]; [key: string]: unknown }> } | null;
    return parsed?.skills || {};
  }

  private readRawIndex(): LegacyRecord[] {
    if (this.fs.kind(this.distribute.indexPath()) !== 'file') return [];
    return this.fs.readText(this.distribute.indexPath())
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LegacyRecord);
  }
}
