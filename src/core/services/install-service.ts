import path from 'node:path';
import type { Consumer, DiscoveredSkill, InstallPlan, InstallResult, SourceCheckout, SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, parseConsumers } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';
import type { SourceService } from './source-service.js';
import type { ViewService } from './view-service.js';

export class InstallService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly source: SourceService,
    private readonly views: ViewService,
  ) {}

  planInstall(sourceCheckout: SourceCheckout, discovered: DiscoveredSkill[], selectors: readonly string[], consumerValues?: readonly string[], options: { overwrite?: boolean } = {}): InstallPlan {
    const selected = this.selectDiscovered(discovered, selectors);
    this.source.assertUniqueSkillDestinations(selected);
    // No legacy default: installs stop tagging 'agents'/'claude' (see ADR-0004;
    // registry tags are catalog ids, migrated by `migrate-consumers`).
    const consumers = parseConsumers(consumerValues, [], { allowEmpty: true });
    const existing = selected.filter((skill) => this.registry.skillExists(skill.name)).map((skill) => skill.name);
    if (existing.length > 0 && !options.overwrite) {
      throw new SkillsManagerError('install_would_overwrite', `Install would overwrite existing skills: ${existing.join(', ')}`, { existing });
    }
    return { source: sourceCheckout, selected, existing, consumers, overwrite: Boolean(options.overwrite) };
  }

  installPlan(plan: InstallPlan): InstallResult {
    for (const skill of plan.selected) this.copySkillToCanonical(skill, plan.source, plan.consumers);
    this.views.rebuildCollections();
    return { installed: plan.selected.map((skill) => skill.name), plan };
  }

  installFromSourceSelection(input: { source: string; selectors: readonly string[]; consumers?: readonly string[]; overwrite?: boolean }) {
    const sourceCheckout = this.source.checkout(input.source);
    const discovered = this.source.discover(sourceCheckout);
    const selectors = input.selectors.length > 0 ? input.selectors : discovered.map((skill) => skill.subpath);
    const plan = this.planInstall(sourceCheckout, discovered, selectors, input.consumers, { overwrite: input.overwrite });
    return this.installPlan(plan);
  }

  private selectDiscovered(discovered: DiscoveredSkill[], selectors: readonly string[]) {
    if (selectors.length === 0) return discovered;
    const requested = new Set(selectors);
    const selected = discovered.filter((skill) => requested.has(skill.subpath) || requested.has(skill.name));
    const missing = [...requested].filter((value) => !selected.some((skill) => skill.subpath === value || skill.name === value));
    if (missing.length > 0) throw new SkillsManagerError('skill_not_discovered', `Requested skills were not discovered: ${missing.join(', ')}`, { missing });
    return selected;
  }

  private copySkillToCanonical(skill: DiscoveredSkill, source: SourceCheckout, consumers: Consumer[]) {
    assertPathInside(skill.absoluteDir, source.repoDir);
    if (this.fs.kind(skill.absoluteDir) !== 'directory') throw new SkillsManagerError('source_skill_missing', `Skill source path does not exist: ${skill.absoluteDir}`);
    const destination = this.registry.skillDir(skill.name);
    assertPathInside(destination, this.home.skillsDir);
    this.fs.makeDirectory(destination);
    this.fs.copyDirectoryContents(skill.absoluteDir, destination);
    this.registry.ensureEntry(skill.name, {
      title: skill.title,
      consumers,
      source: {
        type: source.isLocal ? 'local' : 'git',
        url: source.repoUrl,
        subpath: skill.subpath,
        ref: source.ref || null,
        upstream_commit: source.commit,
      },
      description: skill.description,
    });
  }
}
