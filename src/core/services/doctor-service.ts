import path from 'node:path';
import { CONSUMERS, type DoctorReport, type SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';
import type { RegistryService } from './registry-service.js';
import type { ViewService } from './view-service.js';

export class DoctorService {
  constructor(private readonly fs: FileSystemPort, private readonly git: GitPort, private readonly home: SkillHome, private readonly registry: RegistryService, private readonly views: ViewService) {}

  check(): DoctorReport {
    const warnings: string[] = [];
    if (this.fs.kind(this.home.registryFile) !== 'file') warnings.push(`Missing registry: ${this.home.registryFile}`);
    if (this.fs.kind(this.home.skillsDir) !== 'directory') warnings.push(`Missing skills directory: ${this.home.skillsDir}`);
    const brokenLinks = this.findBrokenLinks([this.home.viewsDir, this.home.collectionsDir]);
    const gitStatus = this.git.statusShort(this.home.root);
    return {
      skillHome: this.home.root,
      skillCount: this.registry.listCanonicalSkills().length,
      viewLinks: {
        agents: this.views.countLinks('agents'),
        claude: this.views.countLinks('claude'),
      },
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
