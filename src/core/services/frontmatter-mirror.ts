import YAML from 'yaml';
import type { SkillName, SkillSource } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { MANAGER_SKILL_NAME } from './manager-skill-service.js';

/**
 * Frontmatter provenance mirror (ADR-0017): SKILL.md frontmatter `metadata:`
 * is a one-way portable projection of the registry entry's source evidence.
 * The registry stays the single source of truth; this module only ever reads
 * registry-shaped sources and writes frontmatter.
 *
 * For git-like sources the four `github-*` keys are DELIBERATE byte-aligned
 * copies of gh skill's `InjectGitHubMetadata` output (cli/cli
 * internal/skills/frontmatter) — that alignment is what makes `gh skill
 * update` recognize our installs. The adjacent `skills-manager-*` keys are
 * the tool's own signature. Do not "fix" either namespace.
 */

/** Registry source types whose evidence gets a mirror. ADR-0016 parity:
 *  archive/local stay mirror-free (no update eligibility, no fake evidence).
 *  wellknown/url join with own-namespace keys (ADR-0017): their evidence is
 *  portable exactly like git's, but never under fake `github-*` names. */
const MIRRORED_SOURCE_TYPES = new Set(['git', 'github', 'marketplace', 'wellknown', 'url']);

/** Skills that never mirror regardless of source. The seeded manager skill
 *  keys its ADR-0014 refresh protocol on the exact tree the bundle laid down
 *  (baseline_hash): a post-laydown mirror write would flip it to user-managed
 *  at the next self-check. It is the tool itself on a bundle-version refresh
 *  channel, not an operator install from a source. */
const UNMIRRORED_SKILLS = new Set([MANAGER_SKILL_NAME]);

/** Frontmatter namespaces this tool owns inside `metadata:` — reprojection
 *  replaces these wholesale and never touches any other key. */
const OWNED_METADATA_KEY = /^(github-|skills-manager-)/;

/** The tool signature written beside the gh-aligned keys: who wrote the
 *  evidence, and at which CLI version (freshness pairs with the anchors). */
const TOOL_IDENTITY = 'skills-manager-cli';

export type FrontmatterMirrorFields = Record<string, string>;

/** The mirror fields a source's evidence projects to — null when the source
 *  kind carries no mirror at all. Git-like kinds speak gh skill's `github-*`
 *  vocabulary; wellknown/url speak `skills-manager-*` only (index URL +
 *  declared digest, download URL + content sha — US12). Null-valued registry
 *  fields are omitted rather than written as empty anchors; a null cliVersion
 *  (version unreadable at the composition root) omits the version identity
 *  key. */
export function mirrorFieldsForSource(source: SkillSource, cliVersion: string | null): FrontmatterMirrorFields | null {
  const type = source.type ?? 'local';
  if (!MIRRORED_SOURCE_TYPES.has(type)) return null;
  const fields: FrontmatterMirrorFields = {};
  if (type === 'wellknown' || type === 'url') {
    if (source.url) fields['skills-manager-source-url'] = source.url;
    if (source.upstream_digest) fields['skills-manager-digest'] = source.upstream_digest;
    if (source.upstream_content_sha) fields['skills-manager-content-sha'] = source.upstream_content_sha;
  } else {
    if (source.url) fields['github-repo'] = source.url;
    if (source.ref) fields['github-ref'] = source.ref;
    if (source.upstream_tree) fields['github-tree-sha'] = source.upstream_tree;
    if (source.subpath) fields['github-path'] = source.subpath;
  }
  fields['skills-manager-written-by'] = TOOL_IDENTITY;
  if (cliVersion) fields['skills-manager-version'] = cliVersion;
  return fields;
}

export type ParsedFrontmatter = {
  data: Record<string, unknown>;
  body: string;
};

/** Split a SKILL.md into its YAML frontmatter map and body. Content without
 *  a leading `---` block is all body, an empty document — same shape gh
 *  skill's Parse returns for frontmatter-less files. */
export function parseSkillFrontmatter(text: string): ParsedFrontmatter {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };
  const parsed = YAML.parse(match[1]) as unknown;
  const data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  return { data, body: text.slice(match[0].length) };
}

/**
 * Write the mirror fields into a SKILL.md's `metadata:` block. Owned keys
 * (`github-*` / `skills-manager-*`) are replaced wholesale — a dirty or stale
 * mirror never survives a reprojection — while every other frontmatter key
 * (top-level and inside `metadata:`) passes through (US15). Key-level fidelity
 * only, like gh skill's RawYAML round-trip through yaml.v3 maps: YAML
 * comments and scalar styling inside the frontmatter do not survive a write.
 * `fields === null` (source kind carries no mirror) leaves the text
 * unchanged. Idempotent: projecting the same fields twice yields
 * byte-identical output.
 */
export function injectFrontmatterMirror(text: string, fields: FrontmatterMirrorFields | null): string {
  if (!fields) return text;
  const { data, body } = parseSkillFrontmatter(text);
  const existingMetadata = data.metadata;
  const kept: Record<string, unknown> = {};
  if (existingMetadata && typeof existingMetadata === 'object' && !Array.isArray(existingMetadata)) {
    for (const [key, value] of Object.entries(existingMetadata as Record<string, unknown>)) {
      if (!OWNED_METADATA_KEY.test(key)) kept[key] = value;
    }
  }
  // Sorted like yaml.v3 marshals Go maps: the metadata block stays
  // byte-identical to what gh skill's serializer emits for the same fields.
  data.metadata = Object.fromEntries(Object.entries({ ...kept, ...fields }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const bodyContent = body.replace(/^[\r\n]+/, '');
  return `---\n${YAML.stringify(data, { indent: 4, lineWidth: 0 })}---\n${bodyContent}`;
}

/**
 * The projector as a domain service: reads a SKILL.md, projects the registry
 * entry's source evidence into its frontmatter. Called from every registry
 * source write point (install first; update / edit --source-* / adopt /
 * detection calibration follow in their tickets).
 */
export class FrontmatterMirrorService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly cliVersion: string | null,
  ) {}

  /** Reproject one skill file. Returns whether this source carries a mirror.
   *  A structurally broken frontmatter (hand-mangled YAML) is skipped, not
   *  fatal: reprojection cannot reconstruct such a document safely, and the
   *  registry write that triggered it must not die on the mirror's account —
   *  the SoT stays saved and the mirror heals once the operator repairs the
   *  file and any write point runs again. */
  project(skillMdPath: string, source: SkillSource): boolean {
    const fields = mirrorFieldsForSource(source, this.cliVersion);
    if (!fields || this.fs.kind(skillMdPath) !== 'file') return false;
    const text = this.fs.readText(skillMdPath);
    let next: string;
    try {
      next = injectFrontmatterMirror(text, fields);
    } catch {
      return false;
    }
    if (next !== text) this.fs.writeText(skillMdPath, next);
    return true;
  }

  /** The registry-facing entry point: reprojection keyed by skill name so the
   *  whole mirror policy (mirrored source kinds, unmirrored skills) stays
   *  inside this module. */
  projectForSkill(skill: SkillName, skillMdPath: string, source: SkillSource): boolean {
    if (UNMIRRORED_SKILLS.has(skill)) return false;
    return this.project(skillMdPath, source);
  }
}
