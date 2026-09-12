import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';

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

/**
 * Programmatic ustar writer for tar-source fixtures (spec source-formats,
 * Testing Decisions) — the tar counterpart of buildZip, deliberately an
 * independent framing implementation so the production reader cannot mirror a
 * bug into the fixture side. Covers the member shapes the tickets need: plain
 * files, directories, symlink members (linkname), and the hostile typeflags
 * (hardlink, device, fifo) plus pax extended headers for long names.
 */
export type TarEntrySpec = {
  name: string;
  /** File content; absent for directory entries. For symlinks the target is `linkname`. */
  data?: string | Buffer;
  /** Permission bits (default 0o644 files / 0o755 dirs). Use 0o755 for the exec-bit fixture. */
  mode?: number;
  /** POSIX typeflag: '0'/'\0' regular (default), '5' directory, '2' symlink,
   *  '1' hardlink, '3' char device, '4' block device, '6' fifo, '7' contiguous. */
  typeflag?: string;
  /** Symlink target (typeflag '2'). */
  linkname?: string;
  /** Emit a pax extended header ('x') before this entry that overrides its path. */
  paxPath?: string;
  /** Emit a GNU longname entry ('L') before this entry carrying this name (the header name stays truncated). */
  gnuLongName?: string;
};

function writeField(header: Buffer, offset: number, value: string, length: number): void {
  header.write(value, offset, length, 'latin1');
}

function writeOctal(header: Buffer, offset: number, value: number, length: number): void {
  writeField(header, offset, `${value.toString(8).padStart(length - 1, '0')}\0`, length);
}

function tarHeader(name: string, size: number, mode: number, typeflag: string, linkname: string): Buffer {
  const header = Buffer.alloc(512);
  writeField(header, 0, name, Math.min(name.length, 100));
  writeOctal(header, 100, mode, 8);
  writeOctal(header, 108, 0, 8);
  writeOctal(header, 116, 0, 8);
  writeOctal(header, 124, size, 12);
  writeOctal(header, 136, 0, 12);
  writeField(header, 148, '        ', 8);
  writeField(header, 156, typeflag, 1);
  writeField(header, 157, linkname, Math.min(linkname.length, 100));
  writeField(header, 257, 'ustar\0', 6);
  writeField(header, 263, '00', 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeField(header, 148, `${sum.toString(8).padStart(6, '0')}\0 `, 8);
  return header;
}

function tarPayload(data: Buffer): Buffer {
  const padding = (512 - (data.length % 512)) % 512;
  return Buffer.concat([data, Buffer.alloc(padding)]);
}

function paxHeader(record: string): Buffer {
  let length = record.length + 1;
  for (;;) {
    const next = `${length} ${record}\n`.length;
    if (next === length) break;
    length = next;
  }
  return Buffer.concat([tarHeader('pax-record', length, 0o644, 'x', ''), tarPayload(Buffer.from(`${length} ${record}\n`, 'utf8'))]);
}

export function buildTar(entries: readonly TarEntrySpec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    if (entry.paxPath !== undefined) blocks.push(paxHeader(`path=${entry.paxPath}`));
    if (entry.gnuLongName !== undefined) {
      const nameBytes = Buffer.concat([Buffer.from(entry.gnuLongName, 'utf8'), Buffer.alloc(1)]);
      blocks.push(tarHeader('././@LongLink', nameBytes.length, 0o644, 'L', ''), tarPayload(nameBytes));
    }
    const isDir = entry.typeflag === '5' || (entry.typeflag === undefined && entry.name.endsWith('/'));
    const data = entry.data === undefined ? Buffer.alloc(0) : Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const typeflag = entry.typeflag ?? (isDir ? '5' : '0');
    const size = typeflag === '5' ? 0 : data.length;
    const mode = entry.mode ?? (isDir ? 0o755 : 0o644);
    blocks.push(tarHeader(entry.name, size, mode, typeflag, entry.linkname ?? ''));
    if (size > 0) blocks.push(tarPayload(data));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

/** A minimal SKILL.md frontmatter body for fixture skills. */
export function skillMarkdown(name: string, description = 'fixture skill'): string {
  return `---\nname: ${name}\ntitle: ${name}\ndescription: ${description}\n---\n# ${name}\n`;
}

/** A gzip-wrapped tar fixture (the .tar.gz / .tgz payloads). The gzip framing
 *  itself is zlib's contract on both sides; the tar framing above stays
 *  independent. */
export function buildTarGz(entries: readonly TarEntrySpec[]): Buffer {
  return gzipSync(buildTar(entries));
}

/** A pre-POSIX v7 tarball: correct framing and checksum, but the ustar magic
 *  field stays NUL — the boundary fixture proving the extractor and the isTar
 *  judgment agree on what `--format tar` may unwrap. */
export function buildV7Tar(name: string, content: string): Buffer {
  const header = Buffer.alloc(512);
  writeField(header, 0, name, Math.min(name.length, 100));
  writeOctal(header, 100, 0o644, 8);
  writeOctal(header, 124, content.length, 12);
  writeField(header, 148, '        ', 8);
  writeField(header, 156, '0', 1);
  let sum = 0;
  for (const byte of header) sum += byte;
  writeField(header, 148, `${sum.toString(8).padStart(6, '0')}\0 `, 8);
  return Buffer.concat([header, tarPayload(Buffer.from(content, 'utf8')), Buffer.alloc(1024)]);
}
