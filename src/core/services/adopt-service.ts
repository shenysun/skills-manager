import path from 'node:path';
import type { Consumer, SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { RegistryService } from './registry-service.js';
import type { ViewService } from './view-service.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { parseConsumers } from '../../shared/validation.js';

export class AdoptService {
  constructor(private readonly fs: FileSystemPort, private readonly home: SkillHome, private readonly registry: RegistryService, private readonly views: ViewService) {}

  adopt(view: string, skill: string, alsoConsumers: readonly string[] = []) {
    const [fromView] = parseConsumers([view]);
    const consumers = parseConsumers([fromView, ...alsoConsumers]);
    const source = path.join(this.home.viewsDir, fromView, skill);
    const destination = this.registry.skillDir(skill);
    if (this.fs.kind(source) !== 'directory') throw new SkillsManagerError('adopt_source_invalid', `${source} must be a real directory inside a generated view`);
    if (this.registry.skillExists(skill) || this.fs.kind(destination) !== 'missing') throw new SkillsManagerError('skill_exists', `Canonical skill already exists: ${destination}`);
    this.fs.move(source, destination);
    this.registry.ensureEntry(skill, { consumers: consumers as Consumer[], source: { type: 'local', url: null, subpath: null, ref: null, upstream_commit: null } });
    this.views.rebuildViews();
    this.views.rebuildCollections();
    return { skill, consumers, path: destination };
  }
}
