import { createHash } from 'node:crypto';
import path from 'node:path';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertSafeSkillName } from '../../shared/validation.js';

/**
 * Well-known discovery-index consumption (source-formats ticket 07, ADR-0016):
 * V2-only (`$schema` = schemas.agentskills.io/discovery/0.2.0). An index
 * without that marker is "format not supported" — never guessed at; entries
 * carry a mandatory sha256 digest that install enforces against the artifact.
 */

export type WellknownIndexEntry = {
  name: string;
  description: string;
  type: 'skill-md' | 'archive';
  url: string;
  digest: string;
};

/** What a successful probe returns: the index URL the artifacts resolve
 *  against, plus its validated entries. Null means no candidate answered —
 *  the caller falls back to the plain direct-download transport. */
export type FetchedWellknownIndex = {
  indexUrl: string;
  entries: WellknownIndexEntry[];
};

/** Resolve an entry's artifact URL against the index URL. The index is a
 *  hostile input, so a malformed reference is an index-invalid error, never a
 *  bare TypeError escaping the checkout. */
export function resolveWellknownArtifactUrl(entry: WellknownIndexEntry, indexUrl: string): string {
  try {
    return new URL(entry.url, indexUrl).href;
  } catch {
    throw invalidIndex(`entry "${entry.name}" has an unresolvable url ${JSON.stringify(entry.url)}`);
  }
}

/** Candidate index URLs for a source URL, in probe order: both candidate
 *  file names (`agent-skills` first — the current convention — then the
 *  legacy `skills` name), site root before the URL's own basePath. */
export function wellknownCandidateUrls(sourceUrl: string): string[] {
  const url = new URL(sourceUrl);
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  const basePath = segments.slice(0, -1).join('/');
  const roots = basePath ? [url.origin, `${url.origin}/${basePath}`] : [url.origin];
  return roots.flatMap((root) => ['agent-skills', 'skills'].map((name) => `${root}/.well-known/${name}/index.json`));
}

function unsupportedIndex(detail = ''): SkillsManagerError {
  return new SkillsManagerError('wellknown_index_unsupported', `The well-known index at this site uses an unsupported format${detail} — only the V2 agent-skills discovery index ($schema 0.2.0) is supported.`);
}

function invalidIndex(detail: string): SkillsManagerError {
  return new SkillsManagerError('wellknown_index_invalid', `The well-known index is invalid: ${detail}`);
}

/** The V2 marker, anchored to its publishing host: an equivalent spelling of
 *  the 0.2.0 identifier (scheme-optional, `/schema.json` suffix optional)
 *  passes; a string that merely *contains* the identifier anywhere (query
 *  strings, other hosts) does not. */
function isV2Schema(schema: unknown): boolean {
  if (typeof schema !== 'string') return false;
  return /^((https?:\/\/)?schemas\.agentskills\.io)\/discovery\/0\.2\.0(\/|$)/.test(schema);
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** Validate a parsed index document: the V2 marker decides support, then every
 *  entry must carry the full consumable shape. Names go through the same
 *  untrusted-metadata checks as SKILL.md frontmatter — an index is a hostile
 *  input exactly like any other source (US-31). */
export function parseWellknownIndex(parsed: unknown): WellknownIndexEntry[] {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw unsupportedIndex();
  if (!isV2Schema((parsed as Record<string, unknown>).$schema)) throw unsupportedIndex();
  const skills = (parsed as Record<string, unknown>).skills;
  if (!Array.isArray(skills)) throw unsupportedIndex();
  const entries: WellknownIndexEntry[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    if (typeof raw !== 'object' || raw === null) throw invalidIndex('an entry is not an object');
    const entry = raw as Record<string, unknown>;
    const name = entry.name;
    if (typeof name !== 'string' || !name.trim()) throw invalidIndex('an entry has no name');
    assertSafeSkillName(name.trim());
    const trimmed = name.trim();
    if (seen.has(trimmed)) throw invalidIndex(`duplicate entry name "${trimmed}"`);
    seen.add(trimmed);
    const type = entry.type;
    if (type !== 'skill-md' && type !== 'archive') throw invalidIndex(`entry "${trimmed}" has an unsupported type ${JSON.stringify(type ?? null)} (expected skill-md or archive)`);
    if (typeof entry.url !== 'string' || !entry.url.trim()) throw invalidIndex(`entry "${trimmed}" has no url`);
    if (typeof entry.digest !== 'string' || !DIGEST_PATTERN.test(entry.digest)) {
      throw invalidIndex(`entry "${trimmed}" has no sha256 digest ("sha256:<hex>") — the digest is mandatory, an unverifiable artifact is never installed`);
    }
    entries.push({
      name: trimmed,
      description: typeof entry.description === 'string' ? entry.description : '',
      type,
      url: entry.url.trim(),
      digest: entry.digest,
    });
  }
  return entries;
}

/** The install-time integrity gate (US-22): the artifact bytes must hash to the
 *  digest the index declared, or the mismatch is an error — index and content
 *  disagreeing is exactly what the anchor exists to catch. */
export function assertDigestMatches(bytes: Buffer, digest: string, entryName: string): void {
  const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
  if (actual !== digest) {
    throw new SkillsManagerError('wellknown_digest_mismatch', `The downloaded artifact for well-known entry "${entryName}" does not match the digest the index declared (${digest}) — the index and its content disagree, refusing to install.`);
  }
}

/** The registry anchor keys on the entry name; a discovered skill's subpath
 *  always sits inside its entry directory (`<entry-name>/…`), so the first
 *  segment is the entry name. */
export function wellknownEntryNameOfSubpath(subpath: string): string {
  return subpath.split('/')[0];
}
