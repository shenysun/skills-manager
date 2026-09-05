import { createSkillHome, SkillHomeService } from './skill-home-service.js';
import { RegistryService } from './registry-service.js';
import { SourceService } from './source-service.js';
import { ViewService } from './view-service.js';
import { DistributeService } from './distribute-service.js';
import { InstallService } from './install-service.js';
import { UpdateService } from './update-service.js';
import { DoctorService } from './doctor-service.js';
import { ActivityService } from './activity-service.js';
import { PackageService } from './package-service.js';
import { ArchiveService } from './archive-service.js';
import { SkillHomeResolver } from './skill-home-resolver.js';
import { AdoptService } from './adopt-service.js';
import { CatalogService } from './catalog-service.js';
import { MigrationService } from './migration-service.js';
import { InitService } from './init-service.js';
import { BackupService } from './backup-service.js';
import { SkillLockService } from './skill-lock-service.js';
import type { CatalogSnapshot } from '../model/catalog.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';
import type { ProcessRunnerPort } from '../ports/process-runner.js';

export type CoreServicesOptions = {
  skillHomeRoot: string;
  projectRoot: string;
  fs: FileSystemPort;
  git: GitPort;
  processRunner: ProcessRunnerPort;
  tempRoot?: string;
  userHome?: string;
  /** Environment override for detection evaluation and path variables; defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Fixture catalog snapshot for tests; defaults to bundled + hub override. */
  catalogSnapshot?: CatalogSnapshot;
};

export function createCoreServices(options: CoreServicesOptions) {
  const home = createSkillHome(options.skillHomeRoot);
  const skillHome = new SkillHomeService(options.fs, home);
  const registry = new RegistryService(options.fs, home);
  const source = new SourceService(options.fs, options.git, options.tempRoot);
  const views = new ViewService(options.fs, home, registry);
  const catalog = new CatalogService(options.fs, home, { snapshot: options.catalogSnapshot, env: options.env, userHomeDir: options.userHome });
  const distribute = new DistributeService(options.fs, home, registry, catalog, options.userHome);
  const install = new InstallService(options.fs, home, registry, source, views, distribute);
  const update = new UpdateService(registry, source, install);
  const doctor = new DoctorService(options.fs, options.git, home, registry, distribute, catalog);
  const activity = new ActivityService(options.fs, options.git, home);
  const archive = new ArchiveService(options.fs, home, registry, views);
  const adopt = new AdoptService();
  const migration = new MigrationService(options.fs, home, distribute, catalog);
  const backups = new BackupService(options.fs, home, registry, distribute);
  const skillLock = new SkillLockService(options.fs, { env: options.env, userHomeDir: options.userHome });
  const init = new InitService(options.fs, home, skillHome, registry, distribute, catalog, backups, skillLock);
  const packageService = new PackageService(options.fs, options.processRunner, options.projectRoot);
  return { home, skillHome, registry, source, views, catalog, distribute, install, update, doctor, activity, archive, adopt, migration, init, backups, package: packageService };
}

export { createSkillHome, SkillHomeService } from './skill-home-service.js';
export { RegistryService } from './registry-service.js';
export { SourceService } from './source-service.js';
export { ViewService } from './view-service.js';
export { DistributeService } from './distribute-service.js';
export { InstallService } from './install-service.js';
export { UpdateService } from './update-service.js';
export { DoctorService } from './doctor-service.js';
export { ActivityService } from './activity-service.js';
export { PackageService } from './package-service.js';
export { ArchiveService } from './archive-service.js';
export { SkillHomeResolver } from './skill-home-resolver.js';
export { AdoptService } from './adopt-service.js';
export { CatalogService } from './catalog-service.js';
export { MigrationService } from './migration-service.js';
export { InitService } from './init-service.js';
export type { InitRunRequest, InitRunResult, InitDiscoveredSkill, InitConflict, InitSkillLocation } from './init-service.js';
export { SkillLockService, lockEntryToSource } from './skill-lock-service.js';
export type { SkillLockEntry, SkillLockOptions } from './skill-lock-service.js';
export { BackupService } from './backup-service.js';
export type { BackupInfo } from './backup-service.js';
