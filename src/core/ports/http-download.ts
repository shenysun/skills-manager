import { SkillsManagerError } from '../../shared/errors.js';

/**
 * The direct-download transport for url/wellknown sources (ADR-0016): one
 * call fetches a payload over http(s) under the ruled transport bounds. The
 * port is synchronous like GitPort — a checkout is a synchronous contract.
 *
 * Every implementation owns the same contract: follow redirects manually and
 * count them against `request.maxRedirects` (the 6th hop is an error), enforce
 * `request.maxBytes` on the stream (abort as soon as the limit is exceeded —
 * never buffer an oversized payload first), bound the connection with
 * `connectTimeoutMs` (through TLS) and every idle stretch with
 * `idleTimeoutMs` (there is deliberately no total cap — the size limit bounds
 * the worst case), and surface the response headers update checks key on
 * (spec source-formats US-13/14/24). Failures throw SkillsManagerError with
 * the DownloadFailureCode that names the branch.
 */

export type DownloadHeaders = {
  contentType?: string;
  etag?: string;
  lastModified?: string;
};

export type DownloadRequest = {
  maxBytes: number;
  maxRedirects: number;
  connectTimeoutMs: number;
  idleTimeoutMs: number;
};

export type DownloadResult = {
  bytes: Buffer;
  headers: DownloadHeaders;
  finalUrl: string;
};

export type DownloadFailureCode =
  | 'download_redirect_limit'
  | 'download_connect_timeout'
  | 'download_idle_timeout'
  | 'download_size_exceeded'
  | 'download_failed';

export interface HttpDownloadPort {
  download(url: string, request: DownloadRequest): DownloadResult;
}

/** Ruled transport bounds (spec source-formats): 100MB download / 5 redirects
 *  / 10s connect / 30s idle-no-progress, no total cap. */
export const DEFAULT_DOWNLOAD_REQUEST: DownloadRequest = {
  maxBytes: 100 * 1024 * 1024,
  maxRedirects: 5,
  connectTimeoutMs: 10_000,
  idleTimeoutMs: 30_000,
};

/** Test-injectability channel for the download size limit (PO ruling, same
 *  standing as SKILLS_MANAGER_ARCHIVE_MAX_BYTES): the ruled default above is
 *  the only production behavior — this override exists so tests can exercise
 *  the size branch with small fixtures, and is deliberately not a documented
 *  configuration surface. */
export function downloadRequestFromEnv(env: Record<string, string | undefined> | undefined): DownloadRequest {
  const raw = env?.SKILLS_MANAGER_DOWNLOAD_MAX_BYTES;
  const maxBytes = typeof raw === 'string' && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_DOWNLOAD_REQUEST.maxBytes;
  return { ...DEFAULT_DOWNLOAD_REQUEST, maxBytes };
}

/** The transport a SourceService gets when none was injected: url sources are
 *  the only consumers, so an unwired hub fails explicitly the moment it tries
 *  to download, instead of silently skipping. Production wiring (runtime.ts)
 *  always injects the real adapter. */
export function unconfiguredHttpDownload(): HttpDownloadPort {
  return {
    download() {
      throw new SkillsManagerError(
        'download_transport_missing',
        'No HTTP download transport is configured for this service — a url source needs an HttpDownloadPort injection.',
      );
    },
  };
}
