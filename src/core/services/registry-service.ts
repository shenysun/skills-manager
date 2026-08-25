import path from 'node:path';
import YAML from 'yaml';
import { type Registry, type RegistryEntry, type Skill, type SkillName, type SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName, isLegacyConsumer, normalizeTags, parseAgentTags, validateRegistrySafePatch, type RegistrySafePatch } from '../../shared/validation.js';

export class RegistryService {
  constructor(private readonly fs: FileSystemPort, private readonly home: SkillHome) {}

  load(): Registry {
    if (!this.fs.exists(this.home.registryFile)) return { skills: {} };
    const parsed = YAML.parse(this.fs.readText(this.home.registryFile)) as Registry | null;
    const registry = parsed && typeof parsed === 'object' && parsed.skills ? parsed : { skills: {} };
    const legacy = Object.entries(registry.skills || {})
      .filter(([, entry]) => (entry.consumers || []).some((value) => isLegacyConsumer(value)))
      .map(([name]) => name);
    if (legacy.length > 0) {
      throw new SkillsManagerError('legacy_consumer_tags', `registry.yaml still uses legacy consumer tags (agents/claude) on: ${legacy.join(', ')}. Run \`skills-manager migrate-consumers\` to migrate them to catalog agent ids.`);
    }
    return registry;
  }

  save(registry: Registry) {
    this.fs.makeDirectory(this.home.root);
    this.fs.writeText(this.home.registryFile, YAML.stringify({ skills: registry.skills || {} }, { lineWidth: 0 }));
  }

  skillDir(skill: SkillName) {
    assertSafeSkillName(skill);
    const dir = path.resolve(this.home.skillsDir, skill);
    assertPathInside(dir, this.home.skillsDir);
    return dir;
  }

  skillExists(skill: SkillName) {
    return this.fs.kind(path.join(this.skillDir(skill), 'SKILL.md')) === 'file';
  }

  listCanonicalSkills(): SkillName[] {
    if (this.fs.kind(this.home.skillsDir) !== 'directory') return [];
    return this.fs.readDirectory(this.home.skillsDir)
      .filter((entry) => entry.kind === 'directory' && !entry.name.startsWith('.') && this.skillExists(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  listSkills(options: { includeArchived?: boolean; consumer?: string; category?: string } = {}): Skill[] {
    const registry = this.load();
    return Object.entries(registry.skills || {})
      .filter(([name, entry]) => (options.includeArchived || !entry.archived) && this.skillExists(name))
      .map(([name, entry]) => this.toSkill(name, entry))
      .filter((skill) => !options.consumer || skill.consumers.includes(options.consumer))
      .filter((skill) => !options.category || skill.category === options.category)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getEntry(skill: SkillName): RegistryEntry | undefined {
    return this.load().skills[skill];
  }


  listSkillFiles(skill: SkillName) {
    const root = this.skillDir(skill);
    const files: string[] = [];
    const walk = (dir: string) => {
      if (this.fs.kind(dir) !== 'directory') return;
      for (const entry of this.fs.readDirectory(dir)) {
        const full = path.join(dir, entry.name);
        if (entry.kind === 'directory') walk(full);
        else if (entry.kind === 'file' || entry.kind === 'symlink') files.push(path.relative(root, full).split(path.sep).join('/'));
      }
    };
    walk(root);
    return files.sort();
  }

  ensureEntry(skill: SkillName, patch: Partial<RegistryEntry> = {}) {
    assertSafeSkillName(skill);
    const registry = this.load();
    registry.skills ||= {};
    registry.skills[skill] = this.defaultEntry(skill, { ...(registry.skills[skill] || {}), ...patch });
    this.save(registry);
    return registry.skills[skill];
  }

  editSafeFields(skill: SkillName, patch: Partial<RegistrySafePatch>) {
    const safePatch = validateRegistrySafePatch(patch);
    const existing = this.getEntry(skill) || this.defaultEntry(skill);
    return this.ensureEntry(skill, {
      ...existing,
      ...safePatch,
      source: safePatch.source ? { ...(existing.source || {}), ...safePatch.source } : existing.source,
    });
  }

  defaultEntry(skill: SkillName, patch: Partial<RegistryEntry> = {}): RegistryEntry {
    assertSafeSkillName(skill);
    // No legacy default tags: desired agents are catalog ids (see ADR-0004).
    const consumers = patch.consumers !== undefined ? parseAgentTags(patch.consumers, undefined, { allowEmpty: true }) : [];
    const entry: RegistryEntry = {
      path: `skills/${skill}`,
      title: skill,
      category: 'experimental',
      tags: [],
      consumers,
      source: { type: 'local', url: null, subpath: null, ref: null, upstream_commit: null },
      update_policy: 'manual',
      description: '',
      ...patch,
    };
    entry.tags = normalizeTags(patch.tags || []);
    entry.consumers = consumers;
    return entry;
  }

  private toSkill(name: SkillName, entry: RegistryEntry): Skill {
    return {
      name,
      path: entry.path || `skills/${name}`,
      title: entry.title || name,
      category: entry.category || 'experimental',
      tags: normalizeTags(entry.tags || []),
      consumers: entry.consumers !== undefined ? parseAgentTags(entry.consumers, undefined, { allowEmpty: true }) : [],
      description: entry.description || '',
      source: entry.source || {},
      archived: Boolean(entry.archived),
    };
  }
}
