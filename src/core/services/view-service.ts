import path from 'node:path';
import { CONSUMERS, type Consumer, type SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { parseConsumers } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';

export class ViewService {
  constructor(private readonly fs: FileSystemPort, private readonly home: SkillHome, private readonly registry: RegistryService) {}

  expose(skill: string, consumers: readonly string[]) {
    const existing = this.registry.getEntry(skill);
    const current = existing?.consumers || [];
    const next = parseConsumers([...current, ...consumers]);
    this.registry.ensureEntry(skill, { ...(existing || {}), consumers: next });
    this.rebuildViews();
  }

  hide(skill: string, consumers: readonly string[]) {
    const remove = parseConsumers(consumers);
    const existing = this.registry.getEntry(skill);
    const current = existing?.consumers || [];
    const next = current.filter((consumer) => !remove.includes(consumer));
    this.registry.ensureEntry(skill, { ...(existing || {}), consumers: next });
    this.rebuildViews();
  }

  rebuildViews() {
    for (const consumer of CONSUMERS) this.safeClearSymlinkDir(path.join(this.home.viewsDir, consumer));
    const registry = this.registry.load();
    for (const [skill, entry] of Object.entries(registry.skills || {})) {
      if (entry.archived || !this.registry.skillExists(skill)) continue;
      for (const consumer of entry.consumers || []) {
        if (consumer === 'agents' || consumer === 'claude') this.linkView(consumer, skill);
      }
    }
  }

  rebuildCollections() {
    this.fs.makeDirectory(this.home.collectionsDir);
    for (const entry of this.fs.readDirectory(this.home.collectionsDir)) {
      const full = path.join(this.home.collectionsDir, entry.name);
      if (entry.kind === 'symlink' || entry.kind === 'file') this.fs.removeFileOrSymlink(full);
      else if (entry.kind === 'directory') this.safeClearSymlinkDir(full);
    }
    const registry = this.registry.load();
    for (const [skill, entry] of Object.entries(registry.skills || {})) {
      if (entry.archived || !this.registry.skillExists(skill)) continue;
      const category = entry.category || 'experimental';
      const dir = path.join(this.home.collectionsDir, category);
      this.fs.makeDirectory(dir);
      const link = path.join(dir, skill);
      if (this.fs.kind(link) === 'missing') this.fs.symlink(path.join('..', '..', 'skills', skill), link);
    }
  }

  countLinks(consumer: Consumer) {
    const dir = path.join(this.home.viewsDir, consumer);
    if (this.fs.kind(dir) !== 'directory') return 0;
    return this.fs.readDirectory(dir).filter((entry) => entry.kind === 'symlink').length;
  }

  private safeClearSymlinkDir(dir: string) {
    this.fs.makeDirectory(dir);
    for (const entry of this.fs.readDirectory(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.kind === 'symlink' || entry.kind === 'file') this.fs.removeFileOrSymlink(full);
      else if (entry.kind === 'directory') throw new SkillsManagerError('unsafe_view_delete', `Refusing to delete a real directory from a generated view: ${full}`);
    }
  }

  private linkView(consumer: Consumer, skill: string) {
    const dir = path.join(this.home.viewsDir, consumer);
    this.fs.makeDirectory(dir);
    const target = path.join(dir, skill);
    const kind = this.fs.kind(target);
    if (kind !== 'missing') {
      if (kind !== 'symlink' && kind !== 'file') throw new SkillsManagerError('unsafe_view_replace', `Refusing to replace a real directory in a generated view: ${target}`);
      this.fs.removeFileOrSymlink(target);
    }
    this.fs.symlink(path.join('..', '..', 'skills', skill), target);
  }
}
