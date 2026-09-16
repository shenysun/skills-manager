import path from 'node:path';
import { type SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { isSafeSkillName } from '../../shared/validation.js';
import { closestMatches } from '../../shared/text-distance.js';
import type { RegistryService } from './registry-service.js';

export type GetTarget = {
  name: string;
  /** The directory the skill currently lives in — canonical, or `.skills/archive/…` once archived. */
  dir: string;
  skillMd: string;
  archived: boolean;
};

/**
 * The reference layer (ADR-0017, CONTEXT "Reference layer"): a hub-only,
 * zero-retention read channel. Resolution never consults distribution state,
 * and archive only exits the management plane — an archived skill resolves
 * through its recorded `archive_path` and stays readable (US22/US25).
 */
export class GetService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
  ) {}

  /** Resolve a hub skill by name, canonical first, archived second; a miss suggests near names (US21). */
  resolve(skill: string): GetTarget {
    const found = this.find(skill);
    if (found) return found;
    const suggestions = closestMatches(skill, this.suggestionPool());
    throw new SkillsManagerError(
      'get_skill_missing',
      `Skill not found: ${skill}.${suggestions.length > 0 ? ` Did you mean: ${suggestions.join(', ')}?` : ' Run `skills-manager list` to see hub skills.'}`,
      { skill, suggestions },
    );
  }

  /** The skill file verbatim — frontmatter (provenance mirror included) + body, byte-exact. */
  read(target: GetTarget): string {
    return this.fs.readText(target.skillMd);
  }

  private find(skill: string): GetTarget | undefined {
    if (isSafeSkillName(skill) && this.registry.skillExists(skill)) {
      return { name: skill, dir: this.registry.skillDir(skill), skillMd: this.registry.skillMdPath(skill), archived: false };
    }
    const entry = this.registry.getEntry(skill);
    const archivePath = entry?.archive_path;
    if (entry?.archived && typeof archivePath === 'string') {
      const dir = path.resolve(this.home.root, archivePath);
      const skillMd = path.join(dir, 'SKILL.md');
      if (this.fs.kind(skillMd) === 'file') return { name: skill, dir, skillMd, archived: true };
    }
    return undefined;
  }

  /** Names a miss can suggest: every live skill plus archived ones — both are gettable. */
  private suggestionPool(): string[] {
    const registry = this.registry.load();
    const archived = Object.entries(registry.skills || {})
      .filter(([, entry]) => entry.archived)
      .map(([name]) => name);
    return [...new Set([...this.registry.listCanonicalSkills(), ...archived])].sort();
  }
}
