import path from 'node:path';
import YAML from 'yaml';
import { type PresetEntry, type Registry, type RegistryEntry, type Skill, type SkillName, type SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafePresetName, assertSafeSkillName, isLegacyConsumer, normalizeTags, parseAgentTags, validateRegistrySafePatch, type RegistrySafePatch } from '../../shared/validation.js';
import type { FrontmatterMirrorService } from './frontmatter-mirror.js';
import { treeContentSha } from './tree-content-hash.js';

export class RegistryService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly mirror: FrontmatterMirrorService,
  ) {}

  load(): Registry {
    if (!this.fs.exists(this.home.registryFile)) return { skills: {} };
    const parsed = YAML.parse(this.fs.readText(this.home.registryFile)) as Registry | null;
    const registry = parsed && typeof parsed === 'object' ? parsed : { skills: {} };
    if (!registry.skills) return { ...registry, skills: {} };
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
    // Presets ride the same file as skills entries (ADR-0019); the key is
    // omitted while empty so a preset-less hub reads exactly as before.
    const presets = registry.presets && Object.keys(registry.presets).length > 0 ? { presets: registry.presets } : {};
    this.fs.writeText(this.home.registryFile, YAML.stringify({ skills: registry.skills || {}, ...presets }, { lineWidth: 0 }));
  }

  skillDir(skill: SkillName) {
    assertSafeSkillName(skill);
    const dir = path.resolve(this.home.skillsDir, skill);
    assertPathInside(dir, this.home.skillsDir);
    return dir;
  }

  skillMdPath(skill: SkillName) {
    return path.join(this.skillDir(skill), 'SKILL.md');
  }

  skillExists(skill: SkillName) {
    return this.fs.kind(this.skillMdPath(skill)) === 'file';
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
    return this.ensureEntries([{ skill, patch }])[0];
  }

  /** Batch ensure: one registry load + one save for N entries, instead of N full-file round trips. */
  ensureEntries(items: ReadonlyArray<{ skill: SkillName; patch: Partial<RegistryEntry> }>) {
    for (const item of items) assertSafeSkillName(item.skill);
    const registry = this.load();
    registry.skills ||= {};
    const skills = { ...registry.skills };
    for (const item of items) {
      skills[item.skill] = this.defaultEntry(item.skill, { ...(skills[item.skill] || {}), ...item.patch });
    }
    this.captureUrlContentAnchors(skills, items);
    this.save({ ...registry, skills });
    this.reprojectMirrors(skills, items);
    return items.map((item) => skills[item.skill]);
  }

  /** Pre-mirror anchor capture (ADR-0016/0017): a url-kind row's implicit
   *  update anchor used to be the hub fingerprint — the frontmatter mirror
   *  projection below changes the hub tree, so the anchor must be made
   *  explicit BEFORE any write point projects. Rows that already carry an
   *  anchor (every install/update since ADR-0017) pass through untouched;
   *  installs provide the authoritative upstream hash themselves, so this only
   *  heals legacy rows whose tree has not yet been mirrored. */
  private captureUrlContentAnchors(skills: Registry['skills'], items: ReadonlyArray<{ skill: SkillName }>) {
    for (const item of items) {
      const entry = skills[item.skill];
      if (entry.source?.type !== 'url' || entry.source.upstream_content_sha) continue;
      const anchor = treeContentSha(this.fs, this.skillDir(item.skill));
      if (anchor) entry.source = { ...entry.source, upstream_content_sha: anchor };
    }
  }

  /** ADR-0017: the registry is the source of truth and the SKILL.md
   *  frontmatter its portable one-way mirror — every entry persisted through
   *  ensureEntries reprojects its source evidence into the skill file. This
   *  is the single choke point behind all five source write points (install
   *  / update / edit --source-* / provenance adopt / detection calibration),
   *  and it also rides title/category edits, where an unchanged source makes
   *  it an idempotent no-op. Reprojection follows save deliberately: if it
   *  fails the SoT is intact and the mirror heals at the next write point.
   *  Mirror-less kinds (archive/local), missing files, and the seeded
   *  manager skill stay untouched; a dirty mirror never survives a write
   *  (US11). */
  private reprojectMirrors(skills: Registry['skills'], items: ReadonlyArray<{ skill: SkillName }>) {
    for (const item of items) {
      const source = skills[item.skill]?.source;
      if (source) this.mirror.projectForSkill(item.skill, this.skillMdPath(item.skill), source);
    }
  }

  removeEntry(skill: SkillName) {
    const registry = this.load();
    if (!registry.skills?.[skill]) return;
    const skills = { ...registry.skills };
    delete skills[skill];
    this.save({ ...registry, skills });
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

  /** Replace the whole category list (same semantics as `edit --categories`, ADR-0015). */
  setCategories(skill: SkillName, categories: readonly string[]) {
    return this.editSafeFields(skill, { categories: [...categories] });
  }

  addCategories(skill: SkillName, categories: readonly string[]) {
    const current = this.getEntry(skill)?.categories || [];
    return this.editSafeFields(skill, { categories: [...current, ...categories] });
  }

  removeCategories(skill: SkillName, categories: readonly string[]) {
    const dropping = new Set(normalizeTags(categories));
    const current = this.getEntry(skill)?.categories || [];
    return this.editSafeFields(skill, { categories: current.filter((value) => !dropping.has(value)) });
  }

  /** Every category in the hub with a per-category skill count — the operator's vocabulary view. */
  listCategoryCounts(): Array<{ category: string; count: number }> {
    const counts = new Map<string, number>();
    for (const skill of this.listSkills()) {
      for (const category of skill.categories) {
        counts.set(category, (counts.get(category) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  }

  /** Replace a preset's whole member list (overwrite-in-place, the same replace
   *  convention as `categories set`; ADR-0019). Storage is deliberately
   *  unvalidated against the vocabulary — build the preset first, tag skills
   *  into its categories later (US16). */
  setPreset(name: string, categories: readonly string[]): PresetEntry {
    assertSafePresetName(name);
    const entry: PresetEntry = { categories: normalizeTags(categories) };
    if (entry.categories.length === 0) {
      throw new SkillsManagerError('invalid_preset', `Preset ${name} needs at least one category. Pass the member categories, e.g. \`preset set ${name} 前端 后端\`.`);
    }
    const registry = this.load();
    this.save({ ...registry, presets: { ...(registry.presets || {}), [name]: entry } });
    return entry;
  }

  /** One preset by exact name — `preset apply`'s lookup (ADR-0019). An absent
   *  name is a hard error, never an empty apply. */
  getPreset(name: string): PresetEntry {
    const entry = this.load().presets?.[name];
    if (!entry) {
      throw new SkillsManagerError('preset_not_found', `No preset named "${name}". Save one with \`preset set ${name} <category...>\`.`);
    }
    return entry;
  }

  listPresets(): Array<{ name: string; categories: string[] }> {
    return Object.entries(this.load().presets || {})
      .map(([name, entry]) => ({ name, categories: normalizeTags(entry?.categories || []) }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Delete a preset entry (ADR-0019). Absent name is the same hard error as
   *  `getPreset` — the cascade caller hears it before anything is detached. */
  removePreset(name: string): PresetEntry {
    const entry = this.getPreset(name);
    const registry = this.load();
    const { [name]: _dropped, ...rest } = registry.presets || {};
    this.save({ ...registry, presets: rest });
    return entry;
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
      categories: [],
      consumers,
      source: { type: 'local', url: null, subpath: null, ref: null, upstream_commit: null, upstream_tree: null, baseline_hash: null },
      update_policy: 'manual',
      description: '',
      ...patch,
    };
    entry.tags = normalizeTags(patch.tags || []);
    entry.categories = normalizeTags(patch.categories || []);
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
      categories: normalizeTags(entry.categories || []),
      consumers: entry.consumers !== undefined ? parseAgentTags(entry.consumers, undefined, { allowEmpty: true }) : [],
      description: entry.description || '',
      source: entry.source || {},
      archived: Boolean(entry.archived),
    };
  }
}
