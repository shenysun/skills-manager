import path from 'node:path';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside } from '../../shared/validation.js';

/**
 * Extraction-safety policy shared by every archive kernel (zip, tar, tar.gz —
 * spec source-formats: the protections are identical across formats and are
 * enforced on the full entry path, no format is a trust exemption). Members
 * are planned first (paths contained, file-type policy applied) and only then
 * materialized in two passes — directories and files before symlinks — so no
 * write can ever travel through a link that does not exist yet, and symlink
 * members are finally judged against the fully materialized tree.
 */

export type ArchiveLimits = {
  maxArchiveBytes: number;
  maxUnpackedBytes: number;
  maxCompressionRatio: number;
  maxMembers: number;
};

/** Ruled values (PO, source-formats spec): 100MB / 500MB / 100x / 10,000. */
export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 100 * 1024 * 1024,
  maxUnpackedBytes: 500 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxMembers: 10_000,
};

/** Test-injectability channel for the extraction limits (PO ruling): the
 *  ruled defaults above are the only production behavior — these env
 *  overrides exist so tests can exercise limit violations with small
 *  fixtures, and are deliberately not a documented configuration surface.
 *  Parsing mirrors the SKILLS_MANAGER_CLONE_TIMEOUT_MS precedent: strict
 *  digit strings above zero, anything else falls back to the default. */
export function archiveLimitsFromEnv(env: Record<string, string | undefined> | undefined): ArchiveLimits {
  const read = (name: string): number | undefined => {
    const raw = env?.[name];
    return typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : undefined;
  };
  return {
    maxArchiveBytes: read('SKILLS_MANAGER_ARCHIVE_MAX_BYTES') ?? DEFAULT_ARCHIVE_LIMITS.maxArchiveBytes,
    maxUnpackedBytes: read('SKILLS_MANAGER_ARCHIVE_MAX_UNPACKED_BYTES') ?? DEFAULT_ARCHIVE_LIMITS.maxUnpackedBytes,
    maxCompressionRatio: read('SKILLS_MANAGER_ARCHIVE_MAX_COMPRESSION_RATIO') ?? DEFAULT_ARCHIVE_LIMITS.maxCompressionRatio,
    maxMembers: read('SKILLS_MANAGER_ARCHIVE_MAX_MEMBERS') ?? DEFAULT_ARCHIVE_LIMITS.maxMembers,
  };
}

export function invalid(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_invalid', message);
}

export function corrupt(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_corrupt', message);
}

export function unsafe(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_member_path_unsafe', message);
}

export function forbidden(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_member_forbidden', message);
}

export function escaped(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_symlink_escape', message);
}

export function limit(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_limit_exceeded', message);
}

/** Symlink chains longer than this are treated as cyclic or hostile. */
export const SYMLINK_HOP_BUDGET = 40;

export type PlannedMember =
  | { kind: 'directory'; path: string }
  | { kind: 'file'; path: string; data: Buffer }
  | { kind: 'symlink'; path: string; target: string };

/** Contained member path: separators normalized, `..` segments and absolute
 *  forms refused, final containment re-asserted (US-9, defense in depth). */
export function resolveMemberPath(destDir: string, name: string): string {
  if (name.length === 0) throw unsafe('archive member has an empty name');
  if (name.includes('\0')) throw unsafe(`archive member name contains a NUL byte: ${JSON.stringify(name)}`);
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(name)) {
    throw unsafe(`archive member has an absolute path: ${JSON.stringify(name)}`);
  }
  const segments = name.split(/[\\/]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw unsafe(`archive member path escapes the extraction root: ${JSON.stringify(name)}`);
  }
  const memberPath = path.join(destDir, ...segments);
  assertPathInside(memberPath, destDir);
  return memberPath;
}

/** Resolve `startPath` against the materialized tree, following symlinks with
 *  a hop budget. Realpath semantics: `..` applies to the already-resolved
 *  position, never to the lexical string — so a path that travels through a
 *  symlink directory is judged by where it really lands. Missing tail
 *  components resolve lexically (nothing is created after this runs, so the
 *  fallback is final). */
export function resolveReal(fs: FileSystemPort, startPath: string, hopBudget: number): string {
  let hopsLeft = hopBudget;
  let current = path.parse(startPath).root;
  const pending = startPath.split(/[\\/]+/);
  while (pending.length > 0) {
    const segment = pending.shift();
    if (segment === undefined || segment === '' || segment === '.') continue;
    if (segment === '..') {
      current = path.dirname(current);
      continue;
    }
    const next = path.join(current, segment);
    if (fs.kind(next) === 'symlink') {
      if (hopsLeft === 0) throw escaped('symlink chain is too long or cyclic');
      hopsLeft -= 1;
      const target = fs.readlink(next);
      if (path.isAbsolute(target)) current = path.parse(target).root;
      pending.unshift(...target.split(/[\\/]+/));
    } else {
      current = next;
    }
  }
  return current;
}

/** Two-pass materialization of planned members (the zip and tar kernels share
 *  this so the policies cannot drift). Pass 1 writes directories and regular
 *  files only — links do not exist yet, so no write can travel through one.
 *  Pass 2 creates symlink members and then re-checks every link's real
 *  resolution against the complete tree, because a chain of
 *  individually-inside links can still lead out. Each link's path must
 *  resolve inside the root BEFORE anything is written for it: an earlier link
 *  can bend a later member's path outside, and creating through it would
 *  write outside the root before the final pass could object. */
export function materializeMembers(fs: FileSystemPort, destDir: string, members: readonly PlannedMember[]): void {
  for (const member of members) {
    if (member.kind === 'directory') fs.makeDirectory(member.path);
    else if (member.kind === 'file') fs.writeBytes(member.path, member.data);
  }

  const links = members.filter((member): member is Extract<PlannedMember, { kind: 'symlink' }> => member.kind === 'symlink');
  if (links.length > 0) {
    const resolvedRoot = resolveReal(fs, destDir, SYMLINK_HOP_BUDGET);
    const assertInside = (link: Extract<PlannedMember, { kind: 'symlink' }>) => {
      const resolved = resolveReal(fs, link.path, SYMLINK_HOP_BUDGET);
      const inside = resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
      if (!inside) throw escaped(`symlink member resolves outside the extraction root: ${JSON.stringify(link.path.slice(destDir.length + 1))}`);
    };
    for (const link of links) {
      assertInside(link);
      fs.makeDirectory(path.dirname(link.path));
      if (fs.kind(link.path) !== 'missing') throw invalid(`conflicting archive member: ${JSON.stringify(link.path.slice(destDir.length + 1))}`);
      fs.symlink(link.target, link.path);
    }
    for (const link of links) assertInside(link);
  }
}
