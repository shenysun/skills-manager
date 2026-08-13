import path from 'node:path';
import type { SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';

export function createSkillHome(root: string): SkillHome {
  return {
    root: path.resolve(root),
    skillsDir: path.resolve(root, 'skills'),
    viewsDir: path.resolve(root, 'views'),
    collectionsDir: path.resolve(root, 'collections'),
    registryFile: path.resolve(root, 'registry.yaml'),
    activityFile: path.resolve(root, '.skills', 'activity.jsonl'),
  };
}

export class SkillHomeService {
  constructor(private readonly fs: FileSystemPort, readonly home: SkillHome) {}

  isSkillHome(root = this.home.root) {
    return this.fs.kind(path.join(root, 'skills')) === 'directory'
      && this.fs.kind(path.join(root, 'registry.yaml')) === 'file';
  }

  ensure() {
    this.fs.makeDirectory(this.home.root);
    this.fs.makeDirectory(this.home.skillsDir);
    this.fs.makeDirectory(this.home.collectionsDir);
    if (!this.fs.exists(this.home.registryFile)) this.fs.writeText(this.home.registryFile, 'skills: {}\n');
    return this.home;
  }

  path(...parts: string[]) {
    return path.join(this.home.root, ...parts);
  }
}
