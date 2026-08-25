import path from 'node:path';
import type { SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import type { DistributeService } from './distribute-service.js';
import type { RegistryService } from './registry-service.js';

export type BackupInfo = {
  skill: string;
  timestamp: string;
  dir: string;
};

export type RestoreResult = {
  restored: boolean;
  skill: string;
  /** Origins that received their displaced original back. */
  runtimePaths: string[];
};

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Recovery aid for `init` (ADR-0006): the displaced original recorded before a
 * runtime path became a back-symlink. Never a second skill store.
 */
export class BackupService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly distribute: DistributeService,
  ) {}

  root() {
    return path.join(this.home.root, '.backups');
  }

  list(): BackupInfo[] {
    if (this.fs.kind(this.root()) !== 'directory') return [];
    return this.fs.readDirectory(this.root())
      .filter((entry) => entry.kind === 'directory')
      .flatMap((entry) => {
        const parsed = parseBackupName(entry.name);
        return parsed ? [{ ...parsed, dir: path.join(this.root(), entry.name) }] : [];
      })
      .sort((a, b) => a.skill.localeCompare(b.skill) || a.timestamp.localeCompare(b.timestamp));
  }

  /** Roll one skill fully back: remove managed symlinks, delete the hub entity and registry entry, return each origin its original. */
  restore(skill: string): RestoreResult {
    const available = this.list().filter((item) => item.skill === skill);
    if (available.length === 0) {
      throw new SkillsManagerError('backup_not_found', `No backup found for skill "${skill}". Run \`skills-manager backup list\` to see what exists.`);
    }

    const runtimePaths = this.managedRuntimePaths(skill);
    if (runtimePaths.length > 0) {
      const agents = [...new Set(this.userIndexEntries(skill).flatMap((entry) => entry.agents))];
      this.distribute.undistribute({ to: 'user', skills: [skill], agents });
    }
    const hubDir = path.join(this.home.skillsDir, skill);
    if (this.fs.kind(hubDir) !== 'missing') this.fs.removeTree(hubDir);
    this.registry.removeEntry(skill);

    // Consume the newest remaining backup per origin; older ones stay until pruned.
    const restoredPaths: string[] = [];
    const pending = [...available].reverse(); // newest first
    for (const runtimePath of runtimePaths) {
      const backup = pending.shift();
      if (!backup) break;
      this.fs.makeDirectory(path.dirname(runtimePath));
      this.fs.move(backup.dir, runtimePath);
      restoredPaths.push(runtimePath);
    }
    return { restored: true, skill, runtimePaths: restoredPaths };
  }

  /** Drop backups older than the 30-day retention window; init runs this alongside a real import. */
  prune(now: Date = new Date()): number {
    const cutoff = now.getTime() - RETENTION_MS;
    let removed = 0;
    for (const item of this.list()) {
      if (backupTime(item.timestamp) < cutoff) {
        this.fs.removeTree(item.dir);
        removed += 1;
      }
    }
    return removed;
  }

  private userIndexEntries(skill: string) {
    return this.distribute.listIndex()
      .filter((record) => record.kind === 'user')
      .flatMap((record) => record.entries.filter((entry) => entry.skill === skill));
  }

  private managedRuntimePaths(skill: string) {
    return this.userIndexEntries(skill).map((entry) => entry.runtimePath);
  }
}

/** Backup dirs are `<skill>-<iso-timestamp>` (with an optional -N uniqueness suffix); the skill name may itself contain dashes. */
export function parseBackupName(name: string): { skill: string; timestamp: string } | null {
  const match = /^(.+)-(\d{4}-\d{2}-\d{2}T[\d-]+Z?)(?:-\d+)?$/.exec(name);
  return match ? { skill: match[1], timestamp: match[2] } : null;
}

/** Timestamps are ISO with `:`/`.` dash-encoded for filesystem safety; decode back to a real time. */
function backupTime(timestamp: string): number {
  const iso = timestamp
    .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
    .replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3Z');
  return new Date(iso).getTime();
}
