import type { ProvenanceAdoptResult, ProvenancePending, SkillName, SkillSource } from '../model/index.js';
import type { RegistryService } from './registry-service.js';
import { lockEntryToSource, type SkillLockService } from './skill-lock-service.js';
import type { FrontmatterEvidenceService } from './frontmatter-evidence.js';

/**
 * Provenance backfill for skills that entered the hub without a usable source
 * (ADR-0012). `adopt` re-runs the import-time evidence adoption over the
 * legacy imported queue — the same evidence gate init applies, minus the
 * "must be a fresh import this run" condition, which is exactly the gap that
 * left pre-ADR-0011 imports source-less. Two evidence channels, frontmatter
 * first (ADR-0017): the hub copy's own `metadata:` mirror covers gh-skill
 * installs (frontmatter-only) as well as our own writes; the `npx skills`
 * lockfile (ADR-0011) covers the rest. Guessed sources are out of scope here:
 * guessing happens in an agent session and only ever lands through `edit`
 * after the user approves each skill.
 */
export class ProvenanceService {
  constructor(
    private readonly registry: RegistryService,
    private readonly lock: SkillLockService,
    private readonly frontmatterEvidence: FrontmatterEvidenceService,
  ) {}

  pending(): ProvenancePending {
    const importedWithoutSource: ProvenancePending['importedWithoutSource'] = [];
    const locallyAuthored: SkillName[] = [];
    for (const [skill, entry] of Object.entries(this.registry.load().skills || {})) {
      if (entry.archived || !this.registry.skillExists(skill)) continue;
      if (entry.source?.url) continue;
      if (entry.imported) importedWithoutSource.push({ skill, importedAt: entry.imported_at ?? null });
      else locallyAuthored.push(skill);
    }
    return {
      importedWithoutSource: importedWithoutSource.sort((a, b) => a.skill.localeCompare(b.skill)),
      locallyAuthored: locallyAuthored.sort((a, b) => a.localeCompare(b)),
    };
  }

  adopt(options: { dryRun?: boolean; skills?: readonly string[] } = {}): ProvenanceAdoptResult {
    const pending = new Set(this.pending().importedWithoutSource.map((item) => item.skill));
    const entries = this.lock.load();
    const adopted: ProvenanceAdoptResult['adopted'] = [];
    const skipped: ProvenanceAdoptResult['skipped'] = [];
    const targets = options.skills && options.skills.length > 0 ? options.skills : [...pending];
    for (const skill of targets) {
      if (!pending.has(skill)) {
        skipped.push({ skill, reason: 'not_pending' });
        continue;
      }
      const source: SkillSource | null = this.frontmatterEvidence.forSkillMd(this.registry.skillMdPath(skill)) ?? lockEntryToSource(entries.get(skill));
      if (!source) {
        skipped.push({ skill, reason: 'no_evidence' });
        continue;
      }
      adopted.push({ skill, source });
    }
    if (!options.dryRun) {
      for (const { skill, source } of adopted) this.registry.editSafeFields(skill, { source });
    }
    return { dryRun: Boolean(options.dryRun), adopted, skipped };
  }
}
