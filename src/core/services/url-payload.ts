import { SkillsManagerError } from '../../shared/errors.js';

/**
 * URL payload format judgment (spec source-formats ticket 04): the extension
 * and the HTTP Content-Type are predictions, the downloaded bytes are the
 * final judge. `--format` overrides both predictions — it only changes what
 * the payload is parsed as, never the url source dispatch (ADR-0016).
 */

export type UrlPayloadFormat = 'md' | 'zip' | 'tar';

const ZIP_MAGIC = Buffer.from('PK');

/** The one unsupported-archive verdict every layer shares (extension
 *  prediction, Content-Type prediction, magic bytes, extractor defense) so the
 *  wording cannot drift between them. */
export function unsupportedArchiveError(detail = ''): SkillsManagerError {
  return new SkillsManagerError('archive_unsupported', `Unsupported archive format${detail}: only zip, tar, and gzip archives are supported.`);
}

export function parseFormatFlag(value: string | undefined): UrlPayloadFormat | undefined {
  if (value === undefined) return undefined;
  if (value === 'md' || value === 'zip' || value === 'tar') return value;
  throw new SkillsManagerError('invalid_format_flag', `--format must be one of md, zip, tar (got ${JSON.stringify(value)}); tar covers tar, tar.gz, and tgz.`);
}

/** Extension prediction — the first link of the chain. A `.tar.bz2` / `.tar.xz`
 *  prediction is refused outright (US-32): the URL declares an archive format
 *  this tool does not support, so there is nothing to download and judge. */
export function predictFromUrlPath(url: string): UrlPayloadFormat | null {
  const file = new URL(url).pathname.split('/').pop() ?? '';
  const lower = file.toLowerCase();
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz') || lower.endsWith('.tbz2') || lower.endsWith('.tar.xz') || lower.endsWith('.txz')) {
    throw unsupportedArchiveError(` ${JSON.stringify(file)}`);
  }
  if (lower.endsWith('.zip')) return 'zip';
  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'md';
  return null;
}

/** Content-Type prediction — the fallback for extension-less URLs (US-4). */
export function predictFromContentType(contentType: string | undefined): UrlPayloadFormat | null {
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'zip';
  if (mime === 'application/gzip' || mime === 'application/x-gzip' || mime === 'application/x-tar' || mime === 'application/x-gtar') return 'tar';
  if (mime === 'application/x-bzip2' || mime === 'application/x-bzip' || mime === 'application/x-xz') {
    throw unsupportedArchiveError(` (Content-Type ${JSON.stringify(mime)})`);
  }
  if (mime.startsWith('text/') || mime === 'application/markdown') return 'md';
  return null;
}

/** Magic-byte verdict on the downloaded payload (US-6): `PK` → zip; gzip and
 *  tar magic → the tar family (compression is the extractor's business, keyed
 *  off the same bytes); anything else has no archive magic, so it is an md
 *  candidate whose frontmatter is the final arbiter. A verdict that
 *  contradicts the prediction is an actionable mismatch — never auto-corrected.
 *  `unknown` means no prediction and no archive magic: the caller falls back
 *  to the single-SKILL.md attempt (ticket 03 behavior for opaque URLs). */
export function judgeUrlPayload(bytes: Buffer, prediction: UrlPayloadFormat | null): UrlPayloadFormat | 'unknown' {
  if (bytes.subarray(0, 2).equals(ZIP_MAGIC)) {
    assertPredictionAgrees('zip', prediction);
    return 'zip';
  }
  if (isGzip(bytes) || isTar(bytes)) {
    assertPredictionAgrees('tar', prediction);
    return 'tar';
  }
  if (isBzip2(bytes) || isXz(bytes)) {
    throw unsupportedArchiveError();
  }
  if (prediction === 'zip' || prediction === 'tar') {
    throw new SkillsManagerError('url_payload_mismatch', `The URL predicts a ${prediction} payload but the download carries no archive magic bytes — if it is a single SKILL.md, pass --format md; otherwise correct the URL.`);
  }
  return prediction === 'md' ? 'md' : 'unknown';
}

function assertPredictionAgrees(verdict: 'zip' | 'tar', prediction: UrlPayloadFormat | null): void {
  if (prediction !== null && prediction !== verdict) {
    throw new SkillsManagerError('url_payload_mismatch', `The URL predicts a ${prediction} payload but the content is ${verdict === 'tar' ? 'a tar/tar.gz archive' : 'a zip archive'} — pass --format ${verdict} to install it as such (mislabeled URLs are never auto-corrected).`);
  }
}

/** The tar-family magic checks live here (not in the extractor) because the
 *  judgment and the extraction disagree on shape: judgment sees the raw
 *  possibly-gzipped bytes, extraction works on a written payload file. */
export function isGzip(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Ustar magic at offset 257 — POSIX and GNU tars both carry it. */
export function isTar(bytes: Buffer): boolean {
  return bytes.length >= 262 && bytes.subarray(257, 262).toString('latin1') === 'ustar';
}

export function isBzip2(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.subarray(0, 3).toString('latin1') === 'BZh' && bytes[3] >= 0x31 && bytes[3] <= 0x39;
}

export function isXz(bytes: Buffer): boolean {
  return bytes.length >= 6 && bytes.subarray(0, 6).equals(Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]));
}
