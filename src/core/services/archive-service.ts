import path from 'node:path';
import type { SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { RegistryService } from './registry-service.js';
import type { ViewService } from './view-service.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside } from '../../shared/validation.js';

export class ArchiveService {
  constructor(private readonly fs: FileSystemPort, private readonly home: SkillHome, private readonly registry: RegistryService, private readonly views: ViewService) {}

  archiveSkills(skills: readonly string[]) {
    const archived: string[] = [];
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveRoot = path.join(this.home.root, '.skills', 'archive', timestamp);
    this.fs.makeDirectory(archiveRoot);
    for (const skill of skills) {
      if (!this.registry.skillExists(skill)) throw new SkillsManagerError('skill_missing', `Skill not found: ${skill}`);
      const source = this.registry.skillDir(skill);
      const destination = path.join(archiveRoot, skill);
      assertPathInside(destination, archiveRoot);
      this.fs.move(source, destination);
      const existing = this.registry.getEntry(skill) || this.registry.defaultEntry(skill);
      this.registry.ensureEntry(skill, { ...existing, archived: true, consumers: [], archived_at: new Date().toISOString(), archive_path: path.relative(this.home.root, destination) });
      archived.push(skill);
    }
    this.views.rebuildCollections();
    return { archived, archiveRoot };
  }
}
