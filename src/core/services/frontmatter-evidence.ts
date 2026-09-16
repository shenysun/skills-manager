import type { SkillSource } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { parseSkillFrontmatter } from './frontmatter-mirror.js';

/**
 * Frontmatter evidence reader (ADR-0017) — the reverse half of the provenance
 * mirror and the lockfile reader's twin evidence channel: it turns a SKILL.md's
 * `metadata:` block back into registry-shaped source evidence, so a skill that
 * arrived carrying its provenance (installed by gh skill, copied out of a
 * project, mirrored by an earlier skills-manager write) enters init import and
 * `provenance adopt` already update-managed. Evidence priority when both
 * channels exist: frontmatter > lockfile — evidence that travelled with the
 * file itself wins (US10).
 *
 * Two namespaces are recognized, git-like first:
 * - `github-*` — the four gh skill keys (`InjectGitHubMetadata`). Whoever
 *   wrote them, the vocabulary is gh's. Host mapping (ADR-0017):
 *   github.com → type `github`; anything else (`*.ghe.com` included) → type
 *   `git`, the generic non-GitHub detection path.
 * - `skills-manager-*` — our own anchor vocabulary (ticket 03): digest →
 *   wellknown, content-sha → url. `skills-manager-source-url` without an
 *   anchor names no kind honestly — that is no evidence, not a guess.
 *
 * The identity keys (`skills-manager-written-by` / `-version`) say who wrote
 * the evidence and when; they are freshness signals, never mapping inputs.
 * Evidence-is-calibration: `github-tree-sha` lands as `upstream_tree`
 * directly — same posture as ADR-0011's skillFolderHash → baseline_hash — so
 * an evidence-backed import owes no first API calibration round (US8).
 */
export function frontmatterToSource(text: string): SkillSource | null {
  let data: Record<string, unknown>;
  try {
    data = parseSkillFrontmatter(text).data;
  } catch {
    return null; // Broken evidence is no evidence — never an import failure.
  }
  const metadata = data.metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const fields = metadata as Record<string, unknown>;

  const repo = stringField(fields, 'github-repo');
  if (repo) {
    return {
      type: githubHosted(repo) ? 'github' : 'git',
      url: repo,
      // '' (and gh's '.') is the repo root itself; null is the registry's word for that.
      subpath: subpathOrNull(stringField(fields, 'github-path')),
      ref: stringField(fields, 'github-ref'),
      upstream_tree: stringField(fields, 'github-tree-sha'),
    };
  }
  const url = stringField(fields, 'skills-manager-source-url');
  if (url) {
    const digest = stringField(fields, 'skills-manager-digest');
    if (digest) return { type: 'wellknown', url, upstream_digest: digest };
    const contentSha = stringField(fields, 'skills-manager-content-sha');
    if (contentSha) return { type: 'url', url, upstream_content_sha: contentSha };
  }
  return null;
}

/** A trimmed non-empty string value, or null — empty anchors are absent anchors. */
function stringField(fields: Record<string, unknown>, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** github.com exactly → `github`; `*.ghe.com`, gitlab, file:// — everything
 *  else, including unparseable URLs → `git` (generic detection path). */
function githubHosted(repoUrl: string): boolean {
  try {
    return new URL(repoUrl).hostname === 'github.com';
  } catch {
    return false;
  }
}

/** Root-anchored skills carry no subpath (update eligibility's word for that is null). */
function subpathOrNull(subpath: string | null): string | null {
  return subpath === '.' ? null : subpath;
}

/** The reader as a domain service: evidence carried by one SKILL.md file.
 *  Missing files and unreadable/broken documents are no evidence, never an
 *  error — same posture as the lockfile reader. */
export class FrontmatterEvidenceService {
  constructor(private readonly fs: FileSystemPort) {}

  forSkillMd(skillMdPath: string): SkillSource | null {
    if (this.fs.kind(skillMdPath) !== 'file') return null;
    try {
      return frontmatterToSource(this.fs.readText(skillMdPath));
    } catch {
      return null;
    }
  }
}
