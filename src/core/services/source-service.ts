import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { DiscoveredSkill, SourceCheckout, SourceSpec } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName, parseSkillMarkdownMetadata } from '../../shared/validation.js';

export class SourceService {
  constructor(private readonly fs: FileSystemPort, private readonly git: GitPort, private readonly tempRoot = os.tmpdir()) {}

  normalize(source: string): SourceSpec {
    const input = source.trim();
    if (!input) throw new SkillsManagerError('missing_source', 'Source is required');
    if (this.fs.exists(input)) return { input, repoUrl: path.resolve(input), isLocal: true };

    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) {
      return { input, repoUrl: `https://github.com/${input}.git`, isLocal: false };
    }

    const githubTree = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/);
    if (githubTree) {
      const [, owner, repo, treeRest] = githubTree;
      return { input, repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`, treeRest, isLocal: false };
    }

    const githubRepo = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/);
    if (githubRepo) {
      const [, owner, repo] = githubRepo;
      return { input, repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`, isLocal: false };
    }

    return { input, repoUrl: input, isLocal: false };
  }

  checkout(source: string, forcedRef?: string): SourceCheckout {
    const normalized = this.normalize(source);
    if (normalized.isLocal) {
      const commit = this.fs.kind(path.join(normalized.repoUrl, '.git')) !== 'missing'
        ? this.git.revParseHead(normalized.repoUrl)
        : null;
      return { ...normalized, repoDir: normalized.repoUrl, commit };
    }

    const tree: { ref?: string; baseSubpath?: string } = normalized.treeRest ? this.resolveGitHubTreeRef(normalized.repoUrl, normalized.treeRest) : (forcedRef ? { ref: forcedRef } : {});
    const repoDir = path.join(this.tempRoot, `skills-source-${randomUUID()}`, 'repo');
    this.fs.makeDirectory(path.dirname(repoDir));
    this.git.clone(normalized.repoUrl, repoDir);
    if (tree.ref) this.git.checkout(repoDir, tree.ref);
    const commit = this.git.revParseHead(repoDir);
    return { ...normalized, ...tree, repoDir, commit };
  }

  discover(source: SourceCheckout): DiscoveredSkill[] {
    const baseDir = source.baseSubpath ? path.join(source.repoDir, source.baseSubpath) : source.repoDir;
    if (this.fs.kind(baseDir) !== 'directory') throw new SkillsManagerError('source_path_missing', `Discovery path does not exist: ${baseDir}`);
    assertPathInside(baseDir, source.repoDir);
    const found: DiscoveredSkill[] = [];
    const walk = (dir: string) => {
      assertPathInside(dir, source.repoDir);
      const skillFile = path.join(dir, 'SKILL.md');
      if (this.fs.kind(skillFile) === 'file') {
        const metadata = parseSkillMarkdownMetadata(this.fs.readText(skillFile));
        const fallbackName = path.basename(dir);
        const name = String(metadata.name || fallbackName).trim();
        assertSafeSkillName(name);
        found.push({
          name,
          title: metadata.title || name,
          description: metadata.description || '',
          subpath: path.relative(source.repoDir, dir).split(path.sep).join('/'),
          absoluteDir: dir,
        });
        return;
      }
      for (const entry of this.fs.readDirectory(dir)) {
        if (entry.kind !== 'directory' || this.shouldSkipDiscoverDir(entry.name)) continue;
        walk(path.join(dir, entry.name));
      }
    };
    walk(baseDir);
    return found.sort((a, b) => a.name.localeCompare(b.name) || a.subpath.localeCompare(b.subpath));
  }

  assertUniqueSkillDestinations(skills: DiscoveredSkill[]) {
    const byName = new Map<string, string[]>();
    for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) || []), skill.subpath]);
    const duplicates = [...byName.entries()].filter(([, subpaths]) => subpaths.length > 1);
    if (duplicates.length > 0) {
      throw new SkillsManagerError('duplicate_skill_names', `Selected skills contain duplicate destination names: ${duplicates.map(([name, subpaths]) => `${name} (${subpaths.join(', ')})`).join('; ')}`);
    }
  }

  private resolveGitHubTreeRef(repoUrl: string, treeRest: string): { ref: string; baseSubpath?: string } {
    const heads = this.git.listRemoteHeads(repoUrl).sort((a, b) => b.length - a.length);
    for (const head of heads) {
      if (treeRest === head) return { ref: head };
      if (treeRest.startsWith(`${head}/`)) return { ref: head, baseSubpath: treeRest.slice(head.length + 1) || undefined };
    }
    const [fallbackRef, ...rest] = treeRest.split('/');
    return { ref: fallbackRef, baseSubpath: rest.join('/') || undefined };
  }

  private shouldSkipDiscoverDir(dirName: string) {
    return ['.git', 'node_modules', 'dist', 'build', '.next', '.turbo'].includes(dirName);
  }
}
