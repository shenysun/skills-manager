import path from 'node:path';
import YAML from 'yaml';
import { SkillsManagerError } from './errors.js';
import { CONSUMERS, type Consumer, type RegistryEntry } from '../core/model/index.js';

export function assertSafeSkillName(name: string): asserts name is string {
  if (!name || name === '.' || name === '..') throw new SkillsManagerError('invalid_skill_name', `Invalid skill name: ${name}`);
  if (name.includes('/') || name.includes('\\')) throw new SkillsManagerError('invalid_skill_name', `Skill name must not contain path separators: ${name}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new SkillsManagerError('invalid_skill_name', `Invalid skill name: ${name}. Use letters, numbers, dot, underscore, or dash, and start with a letter or number.`);
  }
}

export function assertPathInside(child: string, parent: string) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(resolvedParent + path.sep)) {
    throw new SkillsManagerError('path_escape', `Path escape blocked: ${resolvedChild} is not inside ${resolvedParent}`, { child: resolvedChild, parent: resolvedParent });
  }
}

export function isConsumer(value: string): value is Consumer {
  return (CONSUMERS as readonly string[]).includes(value);
}

export function parseConsumers(values: readonly string[] | undefined, fallback?: readonly Consumer[], options: { allowEmpty?: boolean } = {}): Consumer[] {
  const raw = values !== undefined ? values : fallback;
  if (!raw || raw.length === 0) {
    if (options.allowEmpty) return [];
    throw new SkillsManagerError('missing_consumers', `At least one consumer is required: ${CONSUMERS.join(', ')}`);
  }
  const invalid = raw.filter((value) => !isConsumer(String(value)));
  if (invalid.length > 0) throw new SkillsManagerError('invalid_consumer', `Unknown consumers: ${invalid.join(', ')}. Valid values: ${CONSUMERS.join(', ')}`);
  return [...new Set(raw.map((value) => String(value) as Consumer))].sort() as Consumer[];
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))].sort();
}

export type SkillMarkdownMetadata = {
  name?: string;
  title?: string;
  description?: string;
};

export function parseSkillMarkdownMetadata(text: string): SkillMarkdownMetadata {
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  const parsed = YAML.parse(match[1]) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== 'object') return {};
  const metadata: SkillMarkdownMetadata = {};
  if (typeof parsed.name === 'string') {
    const name = parsed.name.trim();
    assertSafeSkillName(name);
    metadata.name = name;
  }
  if (typeof parsed.title === 'string') metadata.title = parsed.title.trim();
  if (typeof parsed.description === 'string') metadata.description = parsed.description.trim();
  return metadata;
}

export type RegistrySafePatch = Pick<RegistryEntry, 'title' | 'category' | 'tags' | 'consumers' | 'source' | 'description'>;

export function validateRegistrySafePatch(patch: Partial<RegistrySafePatch>): Partial<RegistrySafePatch> {
  const next: Partial<RegistrySafePatch> = {};
  if ('title' in patch && patch.title !== undefined) next.title = String(patch.title).trim();
  if ('category' in patch && patch.category !== undefined) next.category = String(patch.category).trim() || 'experimental';
  if ('tags' in patch && patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
  if ('consumers' in patch && patch.consumers !== undefined) next.consumers = parseConsumers(patch.consumers, undefined, { allowEmpty: true });
  if ('description' in patch && patch.description !== undefined) next.description = String(patch.description).trim();
  if ('source' in patch && patch.source !== undefined) {
    const source = patch.source || {};
    next.source = {
      ...source,
      url: source.url === undefined ? undefined : source.url ? String(source.url) : null,
      subpath: source.subpath === undefined ? undefined : source.subpath ? String(source.subpath) : null,
      ref: source.ref === undefined ? undefined : source.ref ? String(source.ref) : null,
      upstream_commit: source.upstream_commit === undefined ? undefined : source.upstream_commit ? String(source.upstream_commit) : null,
    };
  }
  return next;
}
