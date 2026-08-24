import path from 'node:path';
import type { SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import type { RegistryService } from './registry-service.js';

/** Collections organization tree only (ADR-0003): consumer wiring is distribute-to-runtime, never views. */
export class ViewService {
  constructor(private readonly fs: FileSystemPort, private readonly home: SkillHome, private readonly registry: RegistryService) {}

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

  private safeClearSymlinkDir(dir: string) {
    this.fs.makeDirectory(dir);
    for (const entry of this.fs.readDirectory(dir)) {
      const full = path.join(dir, entry.name);
      if (entry.kind === 'symlink' || entry.kind === 'file') this.fs.removeFileOrSymlink(full);
      else if (entry.kind === 'directory') throw new SkillsManagerError('unsafe_view_delete', `Refusing to delete a real directory from a generated view: ${full}`);
    }
  }
}
