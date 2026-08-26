import path from 'node:path';
import type { DoctorReport, SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';
import { RegistryService } from './registry-service.js';
import { DistributeService } from './distribute-service.js';
import { CatalogService } from './catalog-service.js';

const CATALOG_STALE_DAYS = 90;

export class DoctorService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly git: GitPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly distribute: DistributeService,
    private readonly catalog: CatalogService,
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
    const catalog = this.catalog.snapshotInfo();
    if (catalog.ageDays > CATALOG_STALE_DAYS) {
      warnings.push(`Agent catalog snapshot is ${catalog.ageDays} days old (upstream ${catalog.commit.slice(0, 10)}); run \`skills-manager catalog refresh\` to update`);
    }
    const importedWithoutSource = Object.entries(this.registry.load().skills || {})
      .filter(([, entry]) => entry.imported && !entry.source?.url)
      .map(([skill, entry]) => ({ skill, importedAt: entry.imported_at ?? null }))
      .sort((a, b) => a.skill.localeCompare(b.skill));
    if (importedWithoutSource.length > 0) {
      warnings.push(`${importedWithoutSource.length} imported skill(s) have no managed source and may be stale; supply one with \`skills-manager edit <skill> --source-url <url>\` to enable updates`);
    }
    return {
      skillHome: this.home.root,
      skillCount: this.registry.listCanonicalSkills().length,
      distribution,
      brokenLinks,
      warnings,
      gitStatus,
      catalog,
      importedWithoutSource,
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
