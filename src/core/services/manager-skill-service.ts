import path from 'node:path';
import type { RegistryEntry } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { parseSkillMarkdownMetadata } from '../../shared/validation.js';
import type { RegistryService } from './registry-service.js';
import type { DistributeService } from './distribute-service.js';
import type { ViewService } from './view-service.js';

export const MANAGER_SKILL_NAME = 'skills-manager';

/** The npm package's own copy of the manager skill: where it lives and which release it is. */
export type ManagerSkillBundle = {
  /** Package root carrying `skills/skills-manager/`. */
  root: string;
  /** Package version; the release tag is `v<version>`. */
  version: string;
  /** Canonical upstream repo URL — the seeded entry's update source. */
  repoUrl: string;
};

export type ManagerSkillSeedStatus =
  | 'seeded'       // hub had no skills-manager; the bundled copy became it
  | 'refreshed'    // hub copy was exactly what we last seeded; replaced with the bundle
  | 'up-to-date'   // hub copy already matches the bundle
  | 'user-managed'; // hub copy was hand-edited or installed from elsewhere — foreign, not ours to touch

export type ManagerSkillSeedResult = {
  status: ManagerSkillSeedStatus;
  /** Fingerprint of whichever copy is canonical after the call (bundle, or the untouched hub copy). */
  fingerprint: string;
};

/** Compare date-versioned release tags (`2026.9.9`, `2026.9.9-2`) segment by segment. */
export function compareDateVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const [main, suffix = ''] = value.replace(/^v/, '').split('-');
    return { parts: main.split('.').map((n) => Number(n) || 0), suffix: Number(suffix) || 0 };
  };
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.parts.length, right.parts.length); i += 1) {
    const delta = (left.parts[i] || 0) - (right.parts[i] || 0);
    if (delta !== 0) return delta;
  }
  return left.suffix - right.suffix;
}

/**
 * Seed and refresh the hub's manager skill from the copy bundled inside the npm
 * package (ADR-0014). Bootstrap seeds it; every CLI run self-checks it. The
 * entry's `source.baseline_hash` records the exact tree we laid down — the
 * line between "safe to refresh" and "the user owns this copy now".
 */
export class ManagerSkillService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly registry: RegistryService,
    private readonly distribute: DistributeService,
    private readonly views: ViewService,
  ) {}

  bundledDir(bundle: ManagerSkillBundle) {
    return path.join(bundle.root, 'skills', MANAGER_SKILL_NAME);
  }

  /**
   * The every-run hook: refresh the hub copy when we still own it; null when
   * the hub holds no manager skill yet (bootstrap seeds it, an ordinary
   * command never writes one into existence — no surprise writes).
   */
  selfCheck(bundle: ManagerSkillBundle): ManagerSkillSeedResult | null {
    if (!this.registry.skillExists(MANAGER_SKILL_NAME)) return null;
    return this.seed(bundle);
  }

  seed(bundle: ManagerSkillBundle): ManagerSkillSeedResult {
    const bundledDir = this.bundledDir(bundle);
    if (this.fs.kind(path.join(bundledDir, 'SKILL.md')) !== 'file') {
      throw new SkillsManagerError('manager_skill_bundle_missing', `Bundled manager skill not found at ${bundledDir}.`);
    }
    const fingerprint = this.distribute.fingerprintDir(bundledDir);
    if (!this.registry.skillExists(MANAGER_SKILL_NAME)) return this.layDown(bundle, bundledDir, fingerprint);

    const hubFingerprint = this.distribute.fingerprint(MANAGER_SKILL_NAME);
    if (hubFingerprint === fingerprint) return { status: 'up-to-date', fingerprint };
    const entry = this.registry.getEntry(MANAGER_SKILL_NAME);
    if (!this.oursToRefresh(entry, hubFingerprint, bundle.version)) return { status: 'user-managed', fingerprint: hubFingerprint };
    this.layDown(bundle, bundledDir, fingerprint, entry);
    return { status: 'refreshed', fingerprint };
  }

  /** Refresh only what we seeded and nobody has touched since; never roll back to an older bundle. */
  private oursToRefresh(entry: RegistryEntry | undefined, hubFingerprint: string, bundleVersion: string): boolean {
    if (!entry?.source?.baseline_hash || entry.source.baseline_hash !== hubFingerprint) return false;
    const seededRef = entry.source.ref?.replace(/^v/, '');
    if (seededRef && compareDateVersions(bundleVersion, seededRef) < 0) return false;
    return true;
  }

  private layDown(bundle: ManagerSkillBundle, bundledDir: string, fingerprint: string, existing?: RegistryEntry): ManagerSkillSeedResult {
    const metadata = parseSkillMarkdownMetadata(this.fs.readText(path.join(bundledDir, 'SKILL.md')));
    const hubDir = this.registry.skillDir(MANAGER_SKILL_NAME);
    if (this.fs.kind(hubDir) !== 'missing') this.fs.removeTree(hubDir);
    this.fs.makeDirectory(hubDir);
    this.fs.copyDirectoryContents(bundledDir, hubDir);
    const source = {
      type: 'git' as const,
      url: bundle.repoUrl,
      subpath: `skills/${MANAGER_SKILL_NAME}`,
      ref: `v${bundle.version}`,
      upstream_commit: null,
      upstream_tree: null,
      baseline_hash: fingerprint,
    };
    this.registry.ensureEntry(MANAGER_SKILL_NAME, {
      ...(existing || {}),
      title: String(metadata.title || MANAGER_SKILL_NAME),
      description: String(metadata.description || ''),
      source,
    });
    this.views.rebuildCollections();
    return { status: existing ? 'refreshed' : 'seeded', fingerprint };
  }
}
