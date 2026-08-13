import os from 'node:os';
import path from 'node:path';
import type { FileSystemPort } from '../ports/filesystem.js';
import { createSkillHome, SkillHomeService } from './skill-home-service.js';

export type SkillHomeResolutionInput = {
  explicitHome?: string;
  env?: Record<string, string | undefined>;
  cwd?: string;
  defaultHome?: string;
};

export type SkillHomeResolution = {
  root: string;
  reason: 'explicit' | 'env' | 'cwd' | 'default';
  created: boolean;
};

export class SkillHomeResolver {
  constructor(private readonly fs: FileSystemPort) {}

  resolve(input: SkillHomeResolutionInput = {}): SkillHomeResolution {
    const env = input.env || process.env;
    const cwd = path.resolve(input.cwd || process.cwd());
    const defaultHome = path.resolve(input.defaultHome || path.join(os.homedir(), '.skills-manager'));
    if (input.explicitHome) return this.ensure(path.resolve(input.explicitHome), 'explicit');
    if (env.SKILL_HOME) return this.ensure(path.resolve(env.SKILL_HOME), 'env');
    if (this.isSkillHome(cwd)) return { root: cwd, reason: 'cwd', created: false };
    return this.ensure(defaultHome, 'default');
  }

  isSkillHome(root: string) {
    return this.fs.kind(path.join(root, 'skills')) === 'directory'
      && this.fs.kind(path.join(root, 'registry.yaml')) === 'file';
  }

  private ensure(root: string, reason: SkillHomeResolution['reason']): SkillHomeResolution {
    const existed = this.isSkillHome(root);
    const service = new SkillHomeService(this.fs, createSkillHome(root));
    service.ensure();
    this.fs.makeDirectory(path.dirname(service.home.activityFile));
    return { root, reason, created: !existed };
  }
}
