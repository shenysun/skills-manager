import { gunzipSync } from 'node:zlib';
import type { FileSystemPort } from '../ports/filesystem.js';
import {
  DEFAULT_ARCHIVE_LIMITS,
  type ArchiveLimits,
  corrupt,
  forbidden,
  invalid,
  limit,
  materializeMembers,
  type PlannedMember,
  resolveMemberPath,
} from './archive-safety.js';
import { isBzip2, isGzip, isTar, isXz, unsupportedArchiveError } from './url-payload.js';

/**
 * Tar extraction kernel for url sources (spec source-formats ticket 04, US-3):
 * ustar parsing plus pax/GNU extended headers, gzip unwrap by magic bytes —
 * Node built-ins only (bz2/xz stay out of scope and are refused explicitly).
 *
 * The safety policy is not duplicated here: members are planned with the same
 * path containment and file-type rules and materialized through the shared
 * two-pass writer in archive-safety.ts, so tar and zip enforce identical
 * guarantees. Ustar magic is required — pre-POSIX v7 tarballs are outside the
 * supported boundary (assertUstarBoundary keeps the extractor and the isTar
 * judgment from disagreeing about what `--format tar` accepts).
 */

const BLOCK_SIZE = 512;
const MODE_EXEC_BITS = 0o111;

type TarHeader = {
  name: string;
  mode: number;
  size: number;
  typeflag: string;
  linkname: string;
};

type PaxOverrides = { path?: string; size?: number; linkpath?: string };

/** Meta-entry state between a pax/GNU header and the real member it annotates,
 *  plus the running unpacked total and member count. Updated immutably — the
 *  planning loop rebinds the state object. */
type TarPlanState = {
  readonly totalUnpacked: number;
  readonly memberCount: number;
  readonly paxOverrides: PaxOverrides | null;
  readonly gnuLongName: string | null;
  readonly gnuLongLink: string | null;
};

function readTextField(header: Buffer, offset: number, length: number): string {
  let end = offset;
  const fieldEnd = offset + length;
  while (end < fieldEnd && header[end] !== 0) end++;
  return header.subarray(offset, end).toString('utf8').trim();
}

function readOctalField(header: Buffer, offset: number, length: number): number {
  const raw = readTextField(header, offset, length);
  if (raw.length === 0) return 0;
  const value = Number.parseInt(raw, 8);
  if (Number.isNaN(value)) throw corrupt(`tar header carries a malformed numeric field: ${JSON.stringify(raw)}`);
  return value;
}

/** GNU base-256 encoding (binary big-endian) — used when a value outgrows its
 *  octal field. Only sizes can realistically hit it, and any such size is far
 *  beyond the unpacked limit, so the honest verdict is the limit error. */
function readBinarySize(header: Buffer, offset: number, length: number): never {
  let value = 0;
  for (let index = offset + 1; index < offset + length; index++) value = value * 256 + header[index];
  throw limit(`tar member size of ${value} bytes exceeds the maximum unpacked size`);
}

function verifyChecksum(header: Buffer): void {
  const stored = readTextField(header, 148, 8);
  const storedValue = Number.parseInt(stored, 8);
  if (Number.isNaN(storedValue)) throw corrupt('tar header carries a malformed checksum — the payload is not a tar archive');
  let unsigned = 0;
  let signed = 0;
  for (let index = 0; index < BLOCK_SIZE; index++) {
    const byte = index >= 148 && index < 156 ? 0x20 : header[index];
    unsigned += byte;
    signed += byte - 256 * (byte >> 7);
  }
  if (storedValue !== unsigned && storedValue !== signed) {
    throw corrupt('tar header fails its checksum — the payload is not a tar archive');
  }
}

function parseTarHeader(block: Buffer): TarHeader {
  verifyChecksum(block);
  const name = readTextField(block, 0, 100);
  const prefix = readTextField(block, 345, 155);
  const sizeFirstByte = block[124];
  const size = (sizeFirstByte & 0x80) !== 0 ? readBinarySize(block, 124, 12) : readOctalField(block, 124, 12);
  return {
    name: prefix.length > 0 ? `${prefix}/${name}` : name,
    mode: readOctalField(block, 100, 8),
    size,
    typeflag: String.fromCharCode(block[156]),
    linkname: readTextField(block, 157, 100),
  };
}

/** pax extended-header records: `<length> <key>=<value>\n` — only the keys
 *  this kernel consumes are parsed (path, size, linkpath); the rest are skipped. */
function parsePaxRecords(content: Buffer): PaxOverrides {
  const overrides: PaxOverrides = {};
  let position = 0;
  while (position < content.length) {
    const space = content.indexOf(0x20, position);
    if (space < 0) break;
    const recordLength = Number.parseInt(content.subarray(position, space).toString('utf8'), 10);
    if (Number.isNaN(recordLength) || recordLength <= 0 || position + recordLength > content.length) break;
    const record = content.subarray(space + 1, position + recordLength).toString('utf8').replace(/\n$/, '');
    const equals = record.indexOf('=');
    if (equals > 0) {
      const key = record.slice(0, equals);
      const value = record.slice(equals + 1);
      if (key === 'path') overrides.path = value;
      else if (key === 'linkpath') overrides.linkpath = value;
      else if (key === 'size') {
        const size = Number.parseInt(value, 10);
        if (!Number.isNaN(size)) overrides.size = size;
      }
    }
    position += recordLength;
  }
  return overrides;
}

function checkUnpackedTotal(totalUnpacked: number, limits: ArchiveLimits): void {
  if (totalUnpacked > limits.maxUnpackedBytes) {
    throw limit(`archive unpacks to ${totalUnpacked} bytes, exceeding the maximum of ${limits.maxUnpackedBytes} bytes`);
  }
}

/** The ustar boundary the module doc claims: a first block that checksums like
 *  a tar header but carries no ustar magic is pre-POSIX v7 — refused
 *  explicitly, so the --format escape hatch cannot succeed where the auto
 *  judgment (isTar) would have called the same payload a mismatch. Non-tar
 *  garbage keeps the checksum verdict instead. */
function assertUstarBoundary(data: Buffer): void {
  const firstBlock = data.subarray(0, BLOCK_SIZE);
  if (firstBlock.length < BLOCK_SIZE || firstBlock.every((byte) => byte === 0)) return;
  verifyChecksum(firstBlock);
  if (!isTar(data)) throw unsupportedArchiveError(' (pre-POSIX v7 tar is outside the supported boundary)');
}

/** Meta entries (pax x/X, global g, GNU L/K) annotate the next real member;
 *  their payload bytes still count against the unpacked limit. Returns the
 *  updated state, or null when the entry is a real member. */
function consumeMetaEntry(header: TarHeader, content: Buffer, state: TarPlanState, limits: ArchiveLimits): TarPlanState | null {
  const totalUnpacked = state.totalUnpacked + header.size;
  const update = (extra: Partial<TarPlanState>): TarPlanState => {
    checkUnpackedTotal(totalUnpacked, limits);
    return { ...state, totalUnpacked, ...extra };
  };
  switch (header.typeflag) {
    case 'x':
    case 'X':
      return update({ paxOverrides: parsePaxRecords(content) });
    case 'g':
      return update({});
    case 'L':
      return update({ gnuLongName: readTextField(content, 0, content.length) });
    case 'K':
      return update({ gnuLongLink: readTextField(content, 0, content.length) });
    default:
      return null;
  }
}

/** Resolve the pending pax/GNU overrides for this member (pax wins where both
 *  exist) and clear them — each override applies to exactly the next real
 *  member, never beyond it. */
function takeOverrides(state: TarPlanState): { name?: string; size?: number; linkname?: string; state: TarPlanState } {
  return {
    name: state.paxOverrides?.path ?? state.gnuLongName ?? undefined,
    size: state.paxOverrides?.size,
    linkname: state.paxOverrides?.linkpath ?? state.gnuLongLink ?? undefined,
    state: { ...state, paxOverrides: null, gnuLongName: null, gnuLongLink: null },
  };
}

/** File-type policy for non-directory members — same intent as the zip
 *  kernel's mode-bit rules: regular files and symlinks are planned (symlinks
 *  for the two-pass writer), everything else (hardlinks, devices, fifos,
 *  exotics) is refused. The executable-bit refusal applies to regular files
 *  only (directories took the earlier branch). */
function classifyNonDirMember(header: TarHeader, name: string, memberPath: string, content: Buffer, linkname: string): PlannedMember {
  switch (header.typeflag) {
    case '0':
    case '\0':
      if ((header.mode & MODE_EXEC_BITS) !== 0) throw forbidden(`archive member carries the executable bit: ${JSON.stringify(name)}`);
      return { kind: 'file', path: memberPath, data: content };
    case '2':
      if (linkname.length === 0) throw invalid(`symlink member has an empty target: ${JSON.stringify(name)}`);
      return { kind: 'symlink', path: memberPath, target: linkname };
    case '1':
      throw forbidden(`hardlink archive members are not supported: ${JSON.stringify(name)}`);
    case '3':
    case '4':
      throw forbidden(`archive member is a device file: ${JSON.stringify(name)}`);
    case '6':
      throw forbidden(`archive member is a fifo: ${JSON.stringify(name)}`);
    case '7':
      throw forbidden(`archive member has an exotic file type (contiguous): ${JSON.stringify(name)}`);
    default:
      throw invalid(`unsupported tar entry type ${JSON.stringify(header.typeflag)}: ${JSON.stringify(name)}`);
  }
}

function planTarMembers(data: Buffer, destDir: string, limits: ArchiveLimits): PlannedMember[] {
  assertUstarBoundary(data);
  let state: TarPlanState = { totalUnpacked: 0, memberCount: 0, paxOverrides: null, gnuLongName: null, gnuLongLink: null };
  const members: PlannedMember[] = [];
  let offset = 0;
  while (offset < data.length) {
    const block = data.subarray(offset, offset + BLOCK_SIZE);
    if (block.length < BLOCK_SIZE || block.every((byte) => byte === 0)) break;
    const header = parseTarHeader(block);
    offset += BLOCK_SIZE;
    const contentEnd = offset + header.size;
    if (contentEnd > data.length) throw corrupt('tar member data is truncated');
    const content = data.subarray(offset, contentEnd);
    offset = contentEnd + ((BLOCK_SIZE - (header.size % BLOCK_SIZE)) % BLOCK_SIZE);

    const meta = consumeMetaEntry(header, content, state, limits);
    if (meta !== null) {
      state = meta;
      continue;
    }

    if (state.memberCount >= limits.maxMembers) {
      throw limit(`archive has more than ${limits.maxMembers} members, exceeding the maximum of ${limits.maxMembers} members`);
    }
    const overrides = takeOverrides(state);
    state = { ...overrides.state, memberCount: state.memberCount + 1 };
    const name = overrides.name ?? header.name;
    const memberPath = resolveMemberPath(destDir, name);
    if (header.typeflag === '5' || name.endsWith('/')) {
      members.push({ kind: 'directory', path: memberPath });
      continue;
    }
    const member = classifyNonDirMember(header, name, memberPath, content, overrides.linkname ?? header.linkname);
    if (overrides.size !== undefined && overrides.size !== header.size) {
      // A pax size override must agree with the stream, or the framing lies.
      throw corrupt(`tar member ${JSON.stringify(name)} size disagrees between pax header and stream`);
    }
    const totalUnpacked = state.totalUnpacked + header.size;
    checkUnpackedTotal(totalUnpacked, limits);
    state = { ...state, totalUnpacked };
    members.push(member);
  }
  if (state.memberCount === 0) throw invalid('not a tar archive: no member entries');
  return members;
}

/** Node signals a buffer-size refusal as an errno-style `code` property. */
function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

/** Unpack the tar (optionally gzip-wrapped) at `tarPath` into `destDir`,
 *  enforcing the extraction safety policy on the full entry path (spec: no
 *  separate seam for the unpacker). The compression-ratio limit is judged on
 *  the whole archive for gzipped payloads — tar members themselves are
 *  uncompressed, so there is no per-member ratio to lie about. */
export function extractTarArchive(fs: FileSystemPort, tarPath: string, destDir: string, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): void {
  const archiveBytes = fs.size(tarPath);
  if (archiveBytes > limits.maxArchiveBytes) {
    throw limit(`archive is ${archiveBytes} bytes, exceeding the maximum archive size of ${limits.maxArchiveBytes} bytes`);
  }
  const payload = fs.readBytes(tarPath);
  // Defense in depth for the --format escape hatch (US-32): the judgment
  // layer already refuses bz2/xz by prediction and magic, but a forced
  // --format tar lands here with raw bytes — the verdict stays explicit.
  if (isBzip2(payload) || isXz(payload)) {
    throw unsupportedArchiveError();
  }
  let data = payload;
  let gzipped = false;
  if (isGzip(payload)) {
    gzipped = true;
    try {
      data = gunzipSync(payload, { maxOutputLength: limits.maxUnpackedBytes });
    } catch (error) {
      if (hasErrorCode(error, 'ERR_BUFFER_TOO_LARGE')) {
        throw limit(`gzip payload expands beyond the maximum unpacked size of ${limits.maxUnpackedBytes} bytes`);
      }
      throw corrupt('gzip payload failed to decompress — the download is not a valid gzip stream');
    }
  }
  const members = planTarMembers(data, destDir, limits);
  if (gzipped) {
    const ratio = data.length / archiveBytes;
    if (ratio > limits.maxCompressionRatio) {
      throw limit(`archive has a compression ratio of ${Math.round(ratio)}x, exceeding the maximum of ${limits.maxCompressionRatio}x`);
    }
  }
  materializeMembers(fs, destDir, members);
}
