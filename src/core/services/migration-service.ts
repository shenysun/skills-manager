import path from 'node:path';
import YAML from 'yaml';
import type { SkillHome } from '../model/index.js';
import type { CatalogService } from './catalog-service.js';
import type { DistributeService } from './distribute-service.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { isLegacyConsumer } from '../../shared/validation.js';
import { type DistributionIndexEntry, type DistributionIndexRecord } from '../model/index.js';

/** Legacy one-shot bridge (ADR-0004): rewrite registry tags and hub receipts/index onto catalog ids. No translation code survives it. */

type LegacyIndexEntry = { skill: string; consumer: string; mode: 'symlink' | 'copy'; fingerprint: string; runtimePath: string };
type LegacyRecord = { id: string; kind: 'user' | 'project'; targetRoot: string; updatedAt: string; entries: LegacyIndexEntry[] };
type LegacyReceipt = { version: 1; hubRoot: string; updatedAt: string; skills: Record<string, Record<string, { mode: 'symlink' | 'copy'; fingerprint: string; appliedAt: string }>> };

export type MigrationPlan = {
  agentMapping: Record<string, string[]>;
  registryChanges: Array<{ skill: string; from: string[]; to: string[] }>;
  indexEntries: number;
  receipts: string[];
};

export type MigrationResult = {
  migrated: { registrySkills: string[]; indexEntries: number; receipts: string[] };
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
    const receipts = records.filter((record) => record.kind === 'project').map((record) => this.receiptPath(record.targetRoot)).filter((file) => this.fs.kind(file) === 'file');
    return { agentMapping: mapping, registryChanges, indexEntries: records.reduce((count, record) => count + record.entries.filter((entry) => isLegacyConsumer(entry.consumer)).length, 0), receipts };
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

    // 3. Project receipts: version 1 per-consumer maps → version 2 dual-layer entries.
    const receiptBackups: Record<string, string> = {};
    for (const receiptFile of plan.receipts) {
      const legacy = YAML.parse(this.fs.readText(receiptFile)) as LegacyReceipt;
      const record = records.find((item) => this.receiptPath(item.targetRoot) === receiptFile);
      const skills: Record<string, { entries: Array<{ path: string; mode: 'symlink' | 'copy'; fingerprint: string; managed: boolean; agents: string[]; appliedAt: string }> }> = {};
      for (const [skill, perConsumer] of Object.entries(legacy.skills || {})) {
        const entries = [];
        for (const [consumer, info] of Object.entries(perConsumer || {})) {
          if (!isLegacyConsumer(consumer)) continue;
          const fromIndex = record?.entries.find((item) => item.skill === skill && item.consumer === consumer);
          const projectRoot = path.dirname(path.dirname(receiptFile));
          const derived = path.join(projectRoot, `.${consumer}`, 'skills', skill);
          entries.push({
            path: fromIndex?.runtimePath ?? derived,
            mode: info.mode,
            fingerprint: info.fingerprint,
            managed: true,
            agents: mapping[consumer],
            appliedAt: info.appliedAt,
          });
        }
        if (entries.length > 0) skills[skill] = { entries };
      }
      const backupName = this.safeName(receiptFile);
      receiptBackups[backupName] = receiptFile;
      this.fs.writeText(path.join(backupDir, backupName), this.fs.readText(receiptFile));
      this.fs.writeText(receiptFile, YAML.stringify({ version: 2, hubRoot: legacy.hubRoot, updatedAt: legacy.updatedAt, skills }, { lineWidth: 0 }));
    }
    this.fs.writeText(path.join(backupDir, 'manifest.json'), JSON.stringify({ receipts: receiptBackups }, null, 2));

    return { migrated: { registrySkills, indexEntries, receipts: plan.receipts }, backupDir };
  }

  rollback() {
    const root = path.join(this.home.root, '.skills', 'migrate-consumers-backup');
    if (this.fs.kind(root) !== 'directory') throw new SkillsManagerError('migrate_no_backup', `No migrate-consumers backup found under ${root}`);
    const latest = this.fs.readDirectory(root).filter((entry) => entry.kind === 'directory').map((entry) => entry.name).sort().pop();
    if (!latest) throw new SkillsManagerError('migrate_no_backup', `No migrate-consumers backup found under ${root}`);
    const dir = path.join(root, latest);
    this.fs.writeText(this.home.registryFile, this.fs.readText(path.join(dir, 'registry.yaml')));
    this.fs.writeText(this.distribute.indexPath(), this.fs.readText(path.join(dir, 'distributions.jsonl')));
    const manifest = JSON.parse(this.fs.readText(path.join(dir, 'manifest.json'))) as { receipts: Record<string, string> };
    for (const [backupName, original] of Object.entries(manifest.receipts)) {
      this.fs.writeText(original, this.fs.readText(path.join(dir, backupName)));
    }
  }

  private receiptPath(projectRoot: string) {
    return path.join(projectRoot, '.skills-manager', 'distribute.yaml');
  }

  private safeName(file: string) {
    return `receipt-${file.replace(/[^A-Za-z0-9._-]+/g, '_')}`;
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
