import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

/**
 * Programmatic zip writer for archive-source fixtures (spec source-formats,
 * Testing Decisions): builds real zip bytes so extraction behavior is verified
 * against the actual format, not against a mock. Deliberately an independent
 * implementation (its own CRC32, its own headers) so a bug in the production
 * reader cannot be mirrored here and pass both sides.
 *
 * The entry spec covers every fixture shape the tickets need: normal trees,
 * zip-slip member names, executable-bit / special-file modes (unix mode bits in
 * external attributes), symlink members (content = target, S_IFLNK mode), and
 * forged central-directory sizes for lying-header fixtures.
 */

export type ZipEntrySpec = {
  name: string;
  /** File content; absent for directory entries. For symlinks this is the target path. */
  data?: string | Buffer;
  /** Unix mode bits (default 0o644 files / 0o40755 dirs). Use e.g. 0o100755 for the exec-bit fixture, 0o120777 for symlinks. */
  mode?: number;
  /** Compression method; default deflate for files, store for dirs. */
  method?: 'store' | 'deflate';
  /** Forge the central-directory uncompressed size (lying-header fixtures). The local header stays truthful. */
  declaredUncompressed?: number;
  /** Forge the general-purpose flags in both headers (encryption-bit fixtures). */
  flags?: number;
  /** Forge the compression method code in both headers (unsupported-method fixtures, e.g. 12 for bzip2). */
  methodCode?: number;
};

/** Symlink member: content is the target path, mode S_IFLNK|0777. */
export function symlinkEntry(name: string, target: string): ZipEntrySpec {
  return { name, data: target, mode: 0o120777, method: 'store' };
}

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

const UNIX_VERSION_MADE_BY = (0x03 << 8) | 0x14;
const DOS_TIME = 12 << 11;
const DOS_DATE = ((2026 - 1980) << 9) | (9 << 5) | 12;
const UTF8_FLAG = 0x0800;

export function buildZip(entries: readonly ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const raw = entry.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const isDir = entry.name.endsWith('/');
    const method = entry.method ?? (isDir ? 'store' : 'deflate');
    const compressed = isDir || method === 'store' ? raw : deflateRawSync(raw);
    const crc = crc32(raw);
    const mode = entry.mode ?? (isDir ? 0o40755 : 0o644);
    const methodCode = entry.methodCode ?? (isDir || method === 'store' ? 0 : 8);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG | (entry.flags ?? 0), 6);
    local.writeUInt16LE(methodCode, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(UNIX_VERSION_MADE_BY, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG | (entry.flags ?? 0), 8);
    central.writeUInt16LE(methodCode, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.declaredUncompressed ?? raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(mode * 0x10000, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralDirSize = centrals.reduce((total, chunk) => total + chunk.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

/** Write a zip fixture into `dir` and return its path. */
export function writeZip(dir: string, fileName: string, entries: readonly ZipEntrySpec[]): string {
  const filePath = path.join(dir, fileName);
  writeFileSync(filePath, buildZip(entries));
  return filePath;
}

/** A minimal SKILL.md frontmatter body for fixture skills. */
export function skillMarkdown(name: string, description = 'fixture skill'): string {
  return `---\nname: ${name}\ntitle: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}
