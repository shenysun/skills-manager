import { SkillsManagerError } from '../../src/shared/errors.js';
import type { DownloadFailureCode, DownloadHeaders, DownloadRequest, DownloadResult, HttpDownloadPort } from '../../src/core/ports/http-download.js';

/**
 * Programmable HttpDownloadPort (spec source-formats, Testing Decisions): a
 * route function answers each URL with a script of steps — payload bytes,
 * redirects, timeouts, raw statuses. Like a faithful transport it enforces
 * the DownloadRequest bounds itself (redirect counting, on-stream size
 * limit), so SourceService-level tests exercise the real contract branches:
 * the same fake serves tickets 05 and 07 for update/digest flows.
 */

export type FakeHttpStep =
  | { kind: 'redirect'; to: string }
  | { kind: 'bytes'; body: string | Buffer; headers?: Partial<DownloadHeaders> }
  | { kind: 'connect-timeout' }
  | { kind: 'idle-timeout' }
  | { kind: 'status'; status: number };

export type FakeHttpRoutes = (url: string) => FakeHttpStep[];

function failure(code: DownloadFailureCode, message: string): SkillsManagerError {
  return new SkillsManagerError(code, message);
}

export function fakeHttp(routes: FakeHttpRoutes): HttpDownloadPort & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    download(url: string, request: DownloadRequest): DownloadResult {
      calls.push(url);
      let current = url;
      for (let redirects = 0; ; redirects += 1) {
        const steps = routes(current);
        if (steps.length === 0) throw failure('download_failed', `GET ${current} failed with HTTP 404 (no route)`);
        for (const step of steps) {
          if (step.kind === 'redirect') {
            if (redirects >= request.maxRedirects) {
              throw failure('download_redirect_limit', `Too many redirects (more than ${request.maxRedirects}) downloading ${url}`);
            }
            current = new URL(step.to, current).href;
            break;
          }
          if (step.kind === 'connect-timeout') {
            throw failure('download_connect_timeout', `Connection to ${current} timed out after ${request.connectTimeoutMs}ms`);
          }
          if (step.kind === 'idle-timeout') {
            throw failure('download_idle_timeout', `Download from ${current} stalled with no progress for ${request.idleTimeoutMs}ms`);
          }
          if (step.kind === 'status') {
            throw failure('download_failed', `GET ${current} failed with HTTP ${step.status}`);
          }
          const body = Buffer.isBuffer(step.body) ? step.body : Buffer.from(step.body, 'utf8');
          if (body.length > request.maxBytes) {
            throw failure('download_size_exceeded', `Download from ${current} exceeds the maximum of ${request.maxBytes} bytes`);
          }
          return {
            bytes: body,
            headers: {
              contentType: step.headers?.contentType,
              etag: step.headers?.etag,
              lastModified: step.headers?.lastModified,
            },
            finalUrl: current,
          };
        }
      }
    },
  };
}
