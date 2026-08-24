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

  check(options: { projectRoot?: string } = {}): DoctorReport {
    const warnings: string[] = [];
    if (this.fs.kind(this.home.registryFile) !== 'file') warnings.push(`Missing registry: ${this.home.registryFile}`);
    if (this.fs.kind(this.home.skillsDir) !== 'directory') warnings.push(`Missing skills directory: ${this.home.skillsDir}`);
    const leftover = this.distribute.leftoverViewWarning();
    if (leftover) warnings.push(leftover);
    warnings.push(...this.distribute.archivedDistributedWarnings());
    const brokenLinks = [...this.findBrokenLinks([this.home.collectionsDir]), ...this.distribute.runtimeBrokenLinks()].sort();
    const gitStatus = this.git.statusShort(this.home.root);
    let distribution = this.distribute.status();
    if (options.projectRoot) {
      // Project-receipt boundary (ADR-0004): scan the active project's receipt
      // paths too, so machines without this hub's index still get a bounded check.
      const receiptEntries = this.distribute.projectReceiptEntries(options.projectRoot);
      const managed = new Set(this.distribute.listIndex().flatMap((record) => record.entries.map((entry) => entry.runtimePath)));
      const receiptBroken: string[] = [];
      const receiptRoots = new Set<string>();
      for (const entry of receiptEntries) {
        if (managed.has(entry.path)) continue;
        receiptRoots.add(path.dirname(entry.path));
        if (this.fs.kind(entry.path) === 'symlink' && this.fs.targetKind(entry.path) === 'missing') receiptBroken.push(entry.path);
      }
      let receiptForeign = 0;
      for (const dir of receiptRoots) {
        if (this.fs.kind(dir) !== 'directory') continue;
        const known = new Set(receiptEntries.filter((entry) => path.dirname(entry.path) === dir).map((entry) => entry.path));
        for (const item of this.fs.readDirectory(dir)) {
          if (!known.has(path.join(dir, item.name))) receiptForeign += 1;
        }
      }
      brokenLinks.push(...receiptBroken.sort());
      distribution = { ...distribution, foreign: distribution.foreign + receiptForeign };
      warnings.push(`Checked ${receiptEntries.length} physical distribution entries from the project receipt at ${options.projectRoot}`);
    }
    if (distribution.outdated > 0) warnings.push(`${distribution.outdated} distributed skill(s) are outdated versus the hub`);
    if (distribution.foreign > 0) warnings.push(`${distribution.foreign} unmanaged file(s) in consumer runtime skill directories`);
    const catalog = this.catalog.snapshotInfo();
    if (catalog.ageDays > CATALOG_STALE_DAYS) {
      warnings.push(`Agent catalog snapshot is ${catalog.ageDays} days old (upstream ${catalog.commit.slice(0, 10)}); run \`skills-manager catalog refresh\` to update`);
    }
    return {
      skillHome: this.home.root,
      skillCount: this.registry.listCanonicalSkills().length,
      distribution,
      brokenLinks,
      warnings,
      gitStatus,
      catalog,
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
