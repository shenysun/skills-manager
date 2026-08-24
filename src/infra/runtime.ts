import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCoreServices } from '../core/index.js';
import { SkillHomeResolver, type SkillHomeResolution } from '../core/services/skill-home-resolver.js';
import type { CatalogSnapshot } from '../core/model/catalog.js';
import { NodeFileSystem } from './fs-skill-home.js';
import { GitCli } from './git-cli.js';
import { ShellRunner } from './shell-runner.js';

export type RuntimeOptions = {
  home?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
  userHome?: string;
  catalogSnapshot?: CatalogSnapshot;
};

export function projectRootFromImportMeta(metaUrl: string) {
  return path.resolve(path.dirname(fileURLToPath(metaUrl)), '..', '..');
}

export function createRuntimeServices(options: RuntimeOptions = {}, projectRoot = process.cwd()) {
  const fs = new NodeFileSystem();
  const resolver = new SkillHomeResolver(fs);
  const resolution = resolver.resolve({ explicitHome: options.home, cwd: options.cwd || process.cwd(), env: options.env || process.env });
  const git = new GitCli();
  const processRunner = new ShellRunner();
  const env = options.env || process.env;
  const userHome = options.userHome || env.SKILLS_MANAGER_USER_HOME;
  const services = createCoreServices({ skillHomeRoot: resolution.root, projectRoot, fs, git, processRunner, userHome, env: options.env, catalogSnapshot: options.catalogSnapshot });
  services.skillHome.ensure();
  return { ...services, resolution } satisfies ReturnType<typeof createCoreServices> & { resolution: SkillHomeResolution };
}
