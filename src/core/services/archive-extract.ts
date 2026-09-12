import { inflateRawSync } from 'node:zlib';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
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

/**
 * Zip extraction kernel for archive sources (spec source-formats; ADR-0016:
 * an archive install is a one-shot snapshot). Node built-ins only — the zip
 * central directory is parsed directly and deflate goes through zlib, so no
 * new dependency enters the package (bz2/xz stay out of scope).
 *
 * The safety policy is enforced here on the full entry path: member names are
 * normalized and contained, executable-bit and special-file members are
 * refused, every payload is CRC-verified against its header, and symlink
 * members may only resolve inside the extraction root — the shared two-pass
 * materialization in archive-safety.ts carries that verdict, so zip and tar
 * cannot drift apart.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_EOCD_COMMENT = 0xffff;
const CENTRAL_FIXED_SIZE = 46;
const LOCAL_FIXED_SIZE = 30;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_ENCRYPTED = 0x0001;
const ZIP64_PLACEHOLDER = 0xffffffff;

const S_IFMT = 0xf000;
const S_IFDIR = 0x4000;
const S_IFCHR = 0x2000;
const S_IFBLK = 0x6000;
const S_IFREG = 0x8000;
const S_IFLNK = 0xa000;
const S_IFIFO = 0x1000;
const S_IFSOCK = 0xc000;
const MODE_EXEC_BITS = 0o111;

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function crcMismatch(message: string): SkillsManagerError {
  return new SkillsManagerError('archive_crc_mismatch', message);
}

type CentralEntry = {
  name: string;
  method: number;
  flags: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  hostUnix: boolean;
  externalAttrs: number;
};

/** Locate the End of Central Directory record: the signature whose declared
 *  comment length reaches exactly the end of the file. Anything else is not a
 *  zip this kernel will guess at. */
function locateEocd(file: Buffer): number {
  if (file.length < EOCD_MIN_SIZE) return -1;
  const scanFloor = Math.max(0, file.length - EOCD_MIN_SIZE - MAX_EOCD_COMMENT);
  for (let pos = file.length - EOCD_MIN_SIZE; pos >= scanFloor; pos--) {
    if (file.readUInt32LE(pos) !== EOCD_SIGNATURE) continue;
    const commentLength = file.readUInt16LE(pos + 20);
    if (pos + EOCD_MIN_SIZE + commentLength === file.length) return pos;
  }
  return -1;
}

function readCentralDirectory(file: Buffer, eocdOffset: number): CentralEntry[] {
  const count = file.readUInt16LE(eocdOffset + 10);
  const cdSize = file.readUInt32LE(eocdOffset + 12);
  const cdOffset = file.readUInt32LE(eocdOffset + 16);
  if (cdOffset === ZIP64_PLACEHOLDER || cdSize === ZIP64_PLACEHOLDER) {
    throw invalid('zip64 archives are not supported');
  }
  if (cdOffset + cdSize > file.length) throw invalid('not a valid zip archive: central directory is truncated');
  const entries: CentralEntry[] = [];
  let pos = cdOffset;
  for (let index = 0; index < count; index++) {
    if (pos + CENTRAL_FIXED_SIZE > file.length) throw invalid('not a valid zip archive: central directory is truncated');
    if (file.readUInt32LE(pos) !== CENTRAL_SIGNATURE) throw invalid('not a valid zip archive: central directory signature mismatch');
    const versionMadeBy = file.readUInt16LE(pos + 4);
    const entry: CentralEntry = {
      name: '',
      method: file.readUInt16LE(pos + 10),
      flags: file.readUInt16LE(pos + 8),
      crc: file.readUInt32LE(pos + 16),
      compressedSize: file.readUInt32LE(pos + 20),
      uncompressedSize: file.readUInt32LE(pos + 24),
      localOffset: file.readUInt32LE(pos + 42),
      hostUnix: ((versionMadeBy >>> 8) & 0xff) === 3,
      externalAttrs: file.readUInt32LE(pos + 38),
    };
    const nameLength = file.readUInt16LE(pos + 28);
    const extraLength = file.readUInt16LE(pos + 30);
    const commentLength = file.readUInt16LE(pos + 32);
    const recordEnd = pos + CENTRAL_FIXED_SIZE + nameLength + extraLength + commentLength;
    if (recordEnd > file.length) throw invalid('not a valid zip archive: central directory is truncated');
    entry.name = file.subarray(pos + CENTRAL_FIXED_SIZE, pos + CENTRAL_FIXED_SIZE + nameLength).toString('utf8');
    entries.push(entry);
    pos = recordEnd;
  }
  return entries;
}

/** Extract one member's bytes: finds the local header, refuses encryption and
 *  method disagreement, inflates deflate members bounded by the declared
 *  uncompressed size (lying headers fail instead of allocating unbounded). */
function memberData(file: Buffer, entry: CentralEntry): Buffer {
  if (entry.localOffset + LOCAL_FIXED_SIZE > file.length) throw corrupt('member local header is out of bounds');
  const local = entry.localOffset;
  if (file.readUInt32LE(local) !== LOCAL_SIGNATURE) throw corrupt('member local header signature mismatch');
  if (file.readUInt16LE(local + 6) & FLAG_ENCRYPTED) {
    throw new SkillsManagerError('archive_unsupported', 'encrypted archive members are not supported');
  }
  if (file.readUInt16LE(local + 8) !== entry.method) throw corrupt('member compression method disagrees between headers');
  const dataStart = local + LOCAL_FIXED_SIZE + file.readUInt16LE(local + 26) + file.readUInt16LE(local + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > file.length) throw corrupt('member data is truncated');
  const stored = file.subarray(dataStart, dataEnd);
  if (entry.method === METHOD_STORE) {
    if (stored.length !== entry.uncompressedSize) throw corrupt('stored member size disagrees with its header');
    return Buffer.from(stored);
  }
  if (entry.method === METHOD_DEFLATE) {
    let inflated: Buffer;
    try {
      inflated = inflateRawSync(stored, { maxOutputLength: entry.uncompressedSize });
    } catch {
      throw corrupt('member data does not inflate to its declared size');
    }
    if (inflated.length !== entry.uncompressedSize) throw corrupt('member size disagrees with its header');
    return inflated;
  }
  throw new SkillsManagerError('archive_unsupported', `unsupported archive compression method: ${entry.method}`);
}

/** Classify a central-directory entry into a planned member, enforcing the
 *  file-type policy: special files (device/fifo/socket) and regular files
 *  with executable bits are refused outright (US-11). The compression-ratio
 *  limit is judged on the member's ACTUAL bytes — lying headers are caught
 *  by the size checks in memberData before this can misfire on them. */
function planMember(fs: FileSystemPort, file: Buffer, entry: CentralEntry, destDir: string, limits: ArchiveLimits): PlannedMember {
  const memberPath = resolveMemberPath(destDir, entry.name);
  if (entry.flags & FLAG_ENCRYPTED) {
    throw new SkillsManagerError('archive_unsupported', 'encrypted archive members are not supported');
  }
  const mode = entry.hostUnix ? (entry.externalAttrs >>> 16) & 0xffff : 0;
  const fileType = mode & S_IFMT;

  if (entry.hostUnix && (fileType === S_IFCHR || fileType === S_IFBLK || fileType === S_IFIFO || fileType === S_IFSOCK)) {
    throw forbidden(`archive member has a special file type (device/fifo/socket): ${JSON.stringify(entry.name)}`);
  }

  const isDirectory = entry.name.endsWith('/') || fileType === S_IFDIR || (!entry.hostUnix && (entry.externalAttrs & 0x10) !== 0);
  if (isDirectory && fileType !== S_IFLNK) return { kind: 'directory', path: memberPath };

  if (fileType === S_IFLNK) {
    const target = memberData(file, entry).toString('utf8');
    if (target.length === 0) throw invalid(`symlink member has an empty target: ${JSON.stringify(entry.name)}`);
    return { kind: 'symlink', path: memberPath, target };
  }

  if (entry.hostUnix && (mode & MODE_EXEC_BITS) !== 0) {
    throw forbidden(`archive member carries the executable bit: ${JSON.stringify(entry.name)}`);
  }
  const data = memberData(file, entry);
  if (data.length > 0) {
    const ratio = entry.compressedSize === 0 ? Infinity : data.length / entry.compressedSize;
    if (ratio > limits.maxCompressionRatio) {
      throw limit(`archive member ${JSON.stringify(entry.name)} has a compression ratio of ${Math.round(ratio)}x, exceeding the maximum of ${limits.maxCompressionRatio}x`);
    }
  }
  if (crc32(data) !== entry.crc) throw crcMismatch(`member fails its CRC check: ${JSON.stringify(entry.name)}`);
  return { kind: 'file', path: memberPath, data };
}

/** Unpack the zip at `zipPath` into `destDir`, enforcing the extraction safety
 *  policy on the full entry path (spec: no separate seam for the unpacker). */
export function extractZipArchive(fs: FileSystemPort, zipPath: string, destDir: string, limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS): void {
  // US-10 limits. The archive-size check runs before the read so an oversized
  // archive is refused without ever being loaded into memory. Member count and
  // unpacked total are header-level checks over the central directory — they
  // hold against the data too because inflate is bounded by the declared
  // size; the compression ratio is judged per member on its actual bytes in
  // planMember, once lying headers have already failed the size checks.
  const archiveBytes = fs.size(zipPath);
  if (archiveBytes > limits.maxArchiveBytes) {
    throw limit(`archive is ${archiveBytes} bytes, exceeding the maximum archive size of ${limits.maxArchiveBytes} bytes`);
  }
  const file = fs.readBytes(zipPath);
  const eocd = locateEocd(file);
  if (eocd < 0) throw invalid('not a valid zip archive: no end-of-central-directory record');
  const entries = readCentralDirectory(file, eocd);
  if (entries.length > limits.maxMembers) {
    throw limit(`archive has ${entries.length} members, exceeding the maximum of ${limits.maxMembers} members`);
  }
  const totalUnpacked = entries.reduce((total, entry) => total + entry.uncompressedSize, 0);
  if (totalUnpacked > limits.maxUnpackedBytes) {
    throw limit(`archive unpacks to ${totalUnpacked} bytes, exceeding the maximum of ${limits.maxUnpackedBytes} bytes`);
  }
  const members = entries.map((entry) => planMember(fs, file, entry, destDir, limits));
  materializeMembers(fs, destDir, members);
}
