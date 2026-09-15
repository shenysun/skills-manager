import path from 'node:path';
import type { DiscoveredSkill, InstallPlan, InstallResult, SourceCheckout, SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, parseAgentTags } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';
import type { SourceService } from './source-service.js';
import type { ViewService } from './view-service.js';
import type { DistributeService } from './distribute-service.js';
import type { UrlPayloadFormat } from './url-payload.js';
import { wellknownEntryNameOfSubpath } from './wellknown-index.js';

export class InstallService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly source: SourceService,
    private readonly views: ViewService,
    private readonly distribute?: DistributeService,
  ) {}

  planInstall(sourceCheckout: SourceCheckout, discovered: DiscoveredSkill[], selectors: readonly string[], consumerValues?: readonly string[], options: { overwrite?: boolean } = {}): InstallPlan {
    const selected = this.selectDiscovered(discovered, selectors, sourceCheckout);
    this.source.assertUniqueSkillDestinations(selected);
    // No legacy default: installs stop tagging 'agents'/'claude' (see ADR-0004;
    // registry tags are catalog ids, migrated by `migrate-consumers`).
    const consumers = parseAgentTags(consumerValues, [], { allowEmpty: true });
    const existing = selected.filter((skill) => this.registry.skillExists(skill.name)).map((skill) => skill.name);
    if (existing.length > 0 && !options.overwrite) {
      throw new SkillsManagerError('install_would_overwrite', `Install would overwrite existing skills: ${existing.join(', ')}`, { existing });
    }
    return { source: sourceCheckout, selected, existing, consumers, overwrite: Boolean(options.overwrite) };
  }

  installPlan(plan: InstallPlan): InstallResult {
    for (const skill of plan.selected) this.copySkillToCanonical(skill, plan.source, plan.consumers);
    this.views.rebuildCollections();
    if (this.distribute) {
      for (const skill of plan.selected) {
        this.distribute.redistributeOutdatedForSkill(skill.name);
      }
    }
    return { installed: plan.selected.map((skill) => skill.name), plan };
  }

  installFromSourceSelection(input: { source: string; selectors: readonly string[]; consumers?: readonly string[]; overwrite?: boolean; allowInsecureHttp?: boolean; format?: UrlPayloadFormat }) {
    return this.source.withCheckout(input.source, undefined, (sourceCheckout) => {
      const discovered = this.source.discover(sourceCheckout);
      const selectors = input.selectors.length > 0 ? input.selectors : discovered.map((skill) => skill.subpath);
      const plan = this.planInstall(sourceCheckout, discovered, selectors, input.consumers, { overwrite: input.overwrite });
      return this.installPlan(plan);
    }, { allowInsecureHttp: input.allowInsecureHttp, format: input.format });
  }

  /**
   * Selector resolution, most specific match wins: skill subpath, then skill
   * name, then — marketplace checkouts only — a plugin name expanding to all
   * of that plugin's discovered skills (source-formats ticket 06, US-16). A
   * selector naming a manifest plugin whose source form is not consumable
   * (forms 2/3) fails with an explicit not-supported error instead of the
   * generic not-discovered one — silent no-ops never happen (US-17).
   */
  private selectDiscovered(discovered: DiscoveredSkill[], selectors: readonly string[], checkout: SourceCheckout) {
    if (selectors.length === 0) return discovered;
    const selected: DiscoveredSkill[] = [];
    const missing: string[] = [];
    for (const value of new Set(selectors)) {
      const byNameOrPath = discovered.filter((skill) => skill.subpath === value || skill.name === value);
      const matches = byNameOrPath.length > 0 ? byNameOrPath : discovered.filter((skill) => skill.plugin === value);
      if (matches.length > 0) {
        for (const match of matches) if (!selected.includes(match)) selected.push(match);
      } else {
        missing.push(value);
      }
    }
    if (missing.length > 0) {
      for (const value of missing) {
        const reason = this.source.unsupportedMarketplacePlugin(checkout, value);
        if (reason) {
          throw new SkillsManagerError('marketplace_plugin_unsupported', `Marketplace plugin "${value}" references an external repository (${reason}) — not supported yet. Add it from its own repository instead.`);
        }
      }
      throw new SkillsManagerError('skill_not_discovered', `Requested skills were not discovered: ${missing.join(', ')}`, { missing });
    }
    return selected;
  }

  private copySkillToCanonical(skill: DiscoveredSkill, source: SourceCheckout, consumers: string[]) {
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
        // The dispatched kind is the single determinant of the persisted type
        // (source-formats ticket 01); local/git inputs map exactly as before.
        type: source.kind,
        url: source.repoUrl,
        subpath: skill.subpath,
        ref: source.ref || null,
        upstream_commit: source.commit,
        upstream_tree: this.source.upstreamTree(source, skill.subpath),
        // The digest anchor is wellknown-exclusive (ADR-0016): other kinds never
        // carry the key at all. The skill's subpath always sits inside its entry
        // dir, so the first segment names the entry.
        ...(source.wellknownDigests
          ? { upstream_digest: source.wellknownDigests[wellknownEntryNameOfSubpath(skill.subpath)] ?? null }
          : {}),
        // url sources record the download's validators (US-24); every other
        // kind has no http download and stays null.
        upstream_etag: source.httpHeaders?.etag ?? null,
        upstream_last_modified: source.httpHeaders?.lastModified ?? null,
      },
      description: skill.description,
    });
  }
}
