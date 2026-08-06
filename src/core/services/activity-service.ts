import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ActivityRecord, SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';

export class ActivityService {
  constructor(private readonly fs: FileSystemPort, private readonly git: GitPort, private readonly home: SkillHome) {}

  record(input: Omit<ActivityRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }) {
    const record: ActivityRecord = {
      id: input.id || randomUUID(),
      timestamp: input.timestamp || new Date().toISOString(),
      action: input.action,
      summary: input.summary,
      actor: input.actor,
      details: input.details,
    };
    this.fs.makeDirectory(path.dirname(this.home.activityFile));
    this.fs.appendText(this.home.activityFile, `${JSON.stringify(record)}\n`);
    return record;
  }

  list(options: { limit?: number } = {}) {
    if (!this.fs.exists(this.home.activityFile)) return [];
    const lines = this.fs.readText(this.home.activityFile).split('\n').filter(Boolean);
    const records = lines.map((line) => JSON.parse(line) as ActivityRecord).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return typeof options.limit === 'number' ? records.slice(0, options.limit) : records;
  }

  gitHistory(options: { limit?: number } = {}) {
    return this.git.log(this.home.root, options.limit || 20);
  }
}
