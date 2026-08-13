import path from 'node:path';
import type { DoctorReport, SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';
import type { RegistryService } from './registry-service.js';
import type { DistributeService } from './distribute-service.js';

export class DoctorService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly git: GitPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly distribute: DistributeService,
  ) {}

  check(): DoctorReport {
    const warnings: string[] = [];
    if (this.fs.kind(this.home.registryFile) !== 'file') warnings.push(`Missing registry: ${this.home.registryFile}`);
    if (this.fs.kind(this.home.skillsDir) !== 'directory') warnings.push(`Missing skills directory: ${this.home.skillsDir}`);
    const leftover = this.distribute.leftoverViewWarning();
    if (leftover) warnings.push(leftover);
    warnings.push(...this.distribute.archivedDistributedWarnings());
    const brokenLinks = [...this.findBrokenLinks([this.home.collectionsDir]), ...this.distribute.runtimeBrokenLinks()].sort();
    const gitStatus = this.git.statusShort(this.home.root);
    const distribution = this.distribute.status();
    if (distribution.outdated > 0) warnings.push(`${distribution.outdated} distributed skill(s) are outdated versus the hub`);
    if (distribution.foreign > 0) warnings.push(`${distribution.foreign} unmanaged file(s) in consumer runtime skill directories`);
    return {
      skillHome: this.home.root,
      skillCount: this.registry.listCanonicalSkills().length,
      distribution,
      brokenLinks,
      warnings,
      gitStatus,
    };
  }

  private findBrokenLinks(roots: string[]) {
    const broken: string[] = [];
    const walk = (dir: string) => {
      if (this.fs.kind(dir) !== 'directory') return;
      for (const entry of this.fs.readDirectory(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.kind === 'directory') walk(full);
        if (entry.kind === 'symlink' && this.fs.targetKind(full) === 'missing') broken.push(full);
      }
    };
    for (const root of roots) walk(root);
    return broken.sort();
  }
}
