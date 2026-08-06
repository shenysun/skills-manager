import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { assertSkillHome, canonicalSkillsDir, registryPath, skillDir } from './paths.js';
import type { Consumer, Registry, SkillEntry } from './types.js';

export function loadRegistry(): Registry {
  assertSkillHome();
  const file = registryPath();
  if (!existsSync(file)) return { skills: {} };
  const parsed = YAML.parse(readFileSync(file, 'utf8')) as Registry | null;
  return parsed && parsed.skills ? parsed : { skills: {} };
}

export function saveRegistry(registry: Registry) {
  writeFileSync(registryPath(), YAML.stringify(registry, { lineWidth: 0 }));
}

export function skillExists(skill: string) {
  return existsSync(path.join(skillDir(skill), 'SKILL.md'));
}

export function listCanonicalSkills() {
  const dir = canonicalSkillsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && skillExists(name))
    .sort();
}

export function ensureRegistryEntry(skill: string, patch: Partial<SkillEntry> = {}) {
  const registry = loadRegistry();
  registry.skills ||= {};
  registry.skills[skill] = {
    path: `skills/${skill}`,
    title: skill,
    category: 'experimental',
    tags: [],
    consumers: ['agents', 'claude'] satisfies Consumer[],
    source: { type: 'local', url: null, subpath: null, ref: null, upstream_commit: null },
    update_policy: 'manual',
    description: '',
    ...(registry.skills[skill] || {}),
    ...patch,
  };
  saveRegistry(registry);
}
