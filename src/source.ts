import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { table } from 'table';
import { assertPathInside, assertSafeSkillName, skillDir } from './paths.js';
import { ensureRegistryEntry } from './registry.js';
import { run } from './run.js';
import type { Consumer, DiscoveredSkill, SourceInfo, SourceSpec } from './types.js';

function parseSkillFrontmatter(file: string): { name?: string; description?: string } {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  const parsed = YAML.parse(match[1]) as { name?: string; description?: string } | null;
  return parsed || {};
}

export function normalizeSource(source: string): SourceSpec {
  if (existsSync(source)) return { repoUrl: path.resolve(source), isLocal: true };

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    return { repoUrl: `https://github.com/${source}.git`, isLocal: false };
  }

  const githubTree = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/);
  if (githubTree) {
    const [, owner, repo, treeRest] = githubTree;
    return { repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`, treeRest, isLocal: false };
  }

  const githubRepo = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/);
  if (githubRepo) {
    const [, owner, repo] = githubRepo;
    return { repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`, isLocal: false };
  }

  return { repoUrl: source, isLocal: false };
}

function resolveGitHubTreeRef(repoUrl: string, treeRest: string): { ref: string; baseSubpath?: string } {
  const headsOutput = run('git', ['ls-remote', '--heads', repoUrl], { quiet: true });
  const heads = headsOutput
    .split('\n')
    .map((line) => line.match(/refs\/heads\/(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => b.length - a.length);

  for (const head of heads) {
    if (treeRest === head) return { ref: head };
    if (treeRest.startsWith(`${head}/`)) return { ref: head, baseSubpath: treeRest.slice(head.length + 1) || undefined };
  }

  const [fallbackRef, ...rest] = treeRest.split('/');
  return { ref: fallbackRef, baseSubpath: rest.join('/') || undefined };
}

export function checkoutSource(source: string, forcedRef?: string): SourceInfo {
  const normalized = normalizeSource(source);
  if (normalized.isLocal) {
    const commit = existsSync(path.join(normalized.repoUrl, '.git'))
      ? run('git', ['-C', normalized.repoUrl, 'rev-parse', 'HEAD'], { quiet: true })
      : null;
    return { ...normalized, repoDir: normalized.repoUrl, commit };
  }

  const tree: { ref?: string; baseSubpath?: string } = normalized.treeRest ? resolveGitHubTreeRef(normalized.repoUrl, normalized.treeRest) : (forcedRef ? { ref: forcedRef } : {});
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'skills-source-'));
  const repoDir = path.join(tmp, 'repo');
  run('git', ['clone', normalized.repoUrl, repoDir], { cwd: tmp });
  if (tree.ref) run('git', ['-C', repoDir, 'checkout', tree.ref], { quiet: true });
  const commit = run('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { quiet: true });
  return { ...normalized, ...tree, repoDir, commit };
}

function shouldSkipDiscoverDir(dirName: string) {
  return ['.git', 'node_modules', 'dist', 'build', '.next', '.turbo'].includes(dirName);
}

export function discoverSkills(source: SourceInfo): DiscoveredSkill[] {
  const baseDir = source.baseSubpath ? path.join(source.repoDir, source.baseSubpath) : source.repoDir;
  if (!existsSync(baseDir)) throw new Error(`发现路径不存在：${baseDir}`);
  const found: DiscoveredSkill[] = [];
  const walk = (dir: string) => {
    const skillFile = path.join(dir, 'SKILL.md');
    if (existsSync(skillFile)) {
      const fm = parseSkillFrontmatter(skillFile);
      const fallbackName = path.basename(dir);
      const name = String(fm.name || fallbackName).trim();
      assertSafeSkillName(name);
      found.push({
        name,
        title: name,
        description: String(fm.description || '').trim(),
        subpath: path.relative(source.repoDir, dir).split(path.sep).join('/'),
        absoluteDir: dir,
      });
      return;
    }
    for (const item of readdirSync(dir)) {
      if (shouldSkipDiscoverDir(item)) continue;
      const full = path.join(dir, item);
      if (lstatSync(full).isDirectory()) walk(full);
    }
  };
  walk(baseDir);
  return found.sort((a, b) => a.name.localeCompare(b.name) || a.subpath.localeCompare(b.subpath));
}

export function printDiscoveredSkills(skills: DiscoveredSkill[]) {
  console.log(table([
    ['Skill', '路径', 'Description'],
    ...skills.map((skill) => [skill.name, skill.subpath, skill.description || '-']),
  ], {
    columns: {
      0: { alignment: 'left' },
      1: { alignment: 'left' },
      2: { alignment: 'left', width: 72, wrapWord: true },
    },
    drawHorizontalLine: (lineIndex, rowCount) => lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
  }).trimEnd());
}

export function assertUniqueSkillDestinations(skills: DiscoveredSkill[]) {
  const byName = new Map<string, string[]>();
  for (const skill of skills) {
    byName.set(skill.name, [...(byName.get(skill.name) || []), skill.subpath]);
  }
  const duplicates = [...byName.entries()].filter(([, subpaths]) => subpaths.length > 1);
  if (duplicates.length > 0) {
    throw new Error(`选择中存在重复 skill 名称，无法决定安装目标：${duplicates.map(([name, subpaths]) => `${name} (${subpaths.join(', ')})`).join('; ')}`);
  }
}

export function copySkillToCanonical(skill: DiscoveredSkill, source: SourceInfo, consumers: Consumer[]) {
  assertPathInside(skill.absoluteDir, source.repoDir);
  if (!existsSync(skill.absoluteDir)) throw new Error(`skill 源路径不存在：${skill.absoluteDir}`);
  const destination = skillDir(skill.name);
  mkdirSync(destination, { recursive: true });
  run('rsync', ['-a', '--delete', `${skill.absoluteDir}/`, `${destination}/`]);
  ensureRegistryEntry(skill.name, {
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
