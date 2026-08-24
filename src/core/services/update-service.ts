import path from 'node:path';
import type { SourceUpdateGroup, UpdateCandidate, UpdatePlan } from '../model/index.js';
import type { RegistryService } from './registry-service.js';
import type { SourceService } from './source-service.js';
import type { InstallService } from './install-service.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { parseAgentTags } from '../../shared/validation.js';

export class UpdateService {
  constructor(private readonly registry: RegistryService, private readonly source: SourceService, private readonly installer: InstallService) {}

  candidatesFromRegistry(): UpdateCandidate[] {
    const registry = this.registry.load();
    const candidates: UpdateCandidate[] = [];
    for (const [skill, entry] of Object.entries(registry.skills || {})) {
      if (entry.archived || !this.registry.skillExists(skill)) continue;
      const url = entry.source?.url;
      const subpath = entry.source?.subpath;
      if (!url || !subpath) continue;
      candidates.push({
        skill,
        url,
        subpath,
        ref: entry.source?.ref || undefined,
        title: entry.title || skill,
        description: entry.description || '',
        consumers: entry.consumers !== undefined ? parseAgentTags(entry.consumers, undefined, { allowEmpty: true }) : [],
      });
    }
    return candidates.sort((a, b) => a.skill.localeCompare(b.skill));
  }

  plan(): UpdatePlan {
    const candidates = this.candidatesFromRegistry();
    return { candidates, groups: this.groupCandidates(candidates) };
  }

  groupCandidates(candidates: UpdateCandidate[]): SourceUpdateGroup[] {
    const groups = new Map<string, SourceUpdateGroup>();
    for (const candidate of candidates) {
      const key = this.sourceKey(candidate.url, candidate.ref);
      const group = groups.get(key) || { key, url: candidate.url, ref: candidate.ref, skills: [] };
      group.skills.push(candidate);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.url.localeCompare(b.url) || (a.ref || '').localeCompare(b.ref || ''));
  }

  updateSkills(skillNames: readonly string[]) {
    const byName = new Map(this.candidatesFromRegistry().map((candidate) => [candidate.skill, candidate]));
    const missing = skillNames.filter((skill) => !byName.has(skill));
    if (missing.length > 0) throw new SkillsManagerError('update_source_missing', `Skills have no registry source: ${missing.join(', ')}`, { missing });
    return this.updateCandidates(skillNames.map((skill) => byName.get(skill)!));
  }

  updateSource(sourceKey: string, skillNames?: readonly string[]) {
    const group = this.plan().groups.find((item) => item.key === sourceKey);
    if (!group) throw new SkillsManagerError('source_group_missing', `Source group not found: ${sourceKey}`);
    if (!skillNames || skillNames.length === 0) return this.updateCandidates(group.skills);
    const requested = new Set(skillNames);
    const selected = group.skills.filter((candidate) => requested.has(candidate.skill));
    const missing = [...requested].filter((skill) => !selected.some((candidate) => candidate.skill === skill));
    if (missing.length > 0) throw new SkillsManagerError('source_skill_missing', `Skills are not in source group ${sourceKey}: ${missing.join(', ')}`, { missing });
    return this.updateCandidates(selected);
  }

  updateCandidates(candidates: readonly UpdateCandidate[]) {
    if (candidates.length === 0) throw new SkillsManagerError('empty_update_plan', 'No skills to update');
    const installed: string[] = [];
    for (const group of this.groupCandidates([...candidates])) {
      const sourceCheckout = this.source.checkout(group.url, group.ref);
      for (const candidate of group.skills) {
        const discovered = [{
          name: candidate.skill,
          title: candidate.title,
          description: candidate.description,
          subpath: candidate.subpath,
          absoluteDir: path.join(sourceCheckout.repoDir, candidate.subpath),
        }];
        const plan = this.installer.planInstall(sourceCheckout, discovered, [candidate.subpath], candidate.consumers, { overwrite: true });
        installed.push(...this.installer.installPlan(plan).installed);
      }
    }
    return { updated: installed };
  }

  private sourceKey(url: string, ref?: string) {
    return `${url}#${ref || ''}`;
  }
}
