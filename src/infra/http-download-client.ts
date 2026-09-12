import { spawnSync } from 'node:child_process';
import { SkillsManagerError } from '../shared/errors.js';
import type { DownloadFailureCode, DownloadRequest, DownloadResult, HttpDownloadPort } from '../core/ports/http-download.js';

/**
 * HttpDownloadPort adapter over a child node process (the GitPort precedent:
 * the transport runs as an external process so the synchronous port contract
 * costs the main process nothing). The child speaks one line of JSON — the
 * envelope with the verdict, headers and final URL — then the raw payload
 * bytes on stdout; the first newline terminates the envelope, so binary
 * payloads need no escaping. The child enforces the whole transport contract
 * itself: manual redirect counting (a redirect may never downgrade https to
 * cleartext http), socket-level connect and idle timeouts (no total cap), and
 * the size limit aborted on the stream the moment it is exceeded.
 */

export type HttpDownloadClientOptions = {
  /** Extra certificate authority to trust for https (PEM). Production runs
   *  with the system roots; tests inject the throwaway local-test CA. */
  ca?: string;
};

export class HttpDownloadClient implements HttpDownloadPort {
  constructor(private readonly options: HttpDownloadClientOptions = {}) {}

  download(url: string, request: DownloadRequest): DownloadResult {
    const execution = spawnSync(process.execPath, ['-e', CHILD_SCRIPT, JSON.stringify({ url, ...request, ca: this.options.ca })], {
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      // The child never emits more than the envelope plus maxBytes of payload;
      // a buffer over that budget means the child's own enforcement failed.
      maxBuffer: request.maxBytes + ENVELOPE_HEADROOM_BYTES,
    });
    const stdout = execution.stdout || Buffer.alloc(0);
    const newline = stdout.indexOf(0x0a);
    if (execution.error || execution.status !== 0 || newline < 0) {
      const cause = execution.error?.message
        || (execution.stderr ? Buffer.from(execution.stderr).toString('utf8').trim() : '')
        || `download process exited with status ${execution.status ?? 'unknown'}`;
      throw new SkillsManagerError('download_failed', `Downloading ${url} failed: ${cause.split('\n')[0]}`);
    }
    let envelope: { ok: boolean; code?: DownloadFailureCode; message?: string; headers?: DownloadResult['headers']; finalUrl?: string };
    try {
      envelope = JSON.parse(stdout.subarray(0, newline).toString('utf8'));
    } catch {
      throw new SkillsManagerError('download_failed', `Downloading ${url} failed: the download process produced an unreadable result.`);
    }
    if (!envelope.ok) {
      throw new SkillsManagerError(envelope.code || 'download_failed', envelope.message || `Downloading ${url} failed.`);
    }
    return {
      bytes: stdout.subarray(newline + 1),
      headers: envelope.headers ?? {},
      finalUrl: envelope.finalUrl || url,
    };
  }
}

const CHILD_SCRIPT = `
const req = JSON.parse(process.argv[process.argv.length - 1]);
const http = require('http');
const https = require('https');
const REDIRECT_STATUSES = [301, 302, 303, 307, 308];

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope) + '\\n');
}

function fail(code, message) {
  emit({ ok: false, code, message });
  process.exit(0);
}

function fetchOnce(url) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return reject({ code: 'download_failed', message: 'invalid URL: ' + url });
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject({ code: 'download_failed', message: 'unsupported protocol: ' + parsed.protocol });
    }
    const lib = parsed.protocol === 'https:' ? https : http;
    let phase = 'connecting';
    const request = lib.request(parsed, { method: 'GET', ca: req.ca }, (response) => {
      phase = 'body';
      resolve({ status: response.statusCode, headers: response.headers, stream: response });
    });
    request.on('socket', (socket) => {
      // Until the connection is established no data can flow, so the
      // inactivity timer measures the connection itself — for https the TLS
      // handshake is part of connecting, so only secureConnect completes the
      // phase. Once connected, the timer becomes the idle-no-progress bound
      // (headers wait and inter-chunk gaps alike).
      socket.setTimeout(req.connectTimeoutMs);
      const connected = () => {
        if (phase !== 'connecting') return;
        phase = 'connected';
        socket.setTimeout(req.idleTimeoutMs);
      };
      socket.on(parsed.protocol === 'https:' ? 'secureConnect' : 'connect', connected);
      socket.on('timeout', () => {
        request.destroy();
        if (phase === 'connecting') {
          reject({ code: 'download_connect_timeout', message: 'connecting to ' + parsed.host + ' timed out after ' + req.connectTimeoutMs + 'ms' });
        } else {
          reject({ code: 'download_idle_timeout', message: 'download from ' + parsed.host + ' stalled with no progress for ' + req.idleTimeoutMs + 'ms' });
        }
      });
    });
    request.on('error', (error) => {
      reject({ code: 'download_failed', message: 'GET ' + url + ' failed: ' + (error && error.message ? error.message : String(error)) });
    });
    request.end();
  });
}

function readBody(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    stream.on('data', (chunk) => {
      total += chunk.length;
      if (total > req.maxBytes) {
        stream.destroy();
        settle(reject, { code: 'download_size_exceeded', message: 'payload exceeds the maximum of ' + req.maxBytes + ' bytes' });
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => settle(resolve, Buffer.concat(chunks)));
    stream.on('error', (error) => settle(reject, { code: 'download_failed', message: 'connection failed mid-download: ' + (error && error.message ? error.message : String(error)) }));
  });
}

(async () => {
  let current = new URL(req.url);
  let redirects = 0;
  for (;;) {
    const hop = await fetchOnce(current.href);
    if (REDIRECT_STATUSES.includes(hop.status)) {
      const location = hop.headers.location;
      hop.stream.resume();
      if (!location) fail('download_failed', 'redirect status ' + hop.status + ' without a Location header');
      redirects += 1;
      if (redirects > req.maxRedirects) {
        fail('download_redirect_limit', 'too many redirects (more than ' + req.maxRedirects + ') downloading ' + req.url);
      }
      const next = new URL(location, current);
      if (current.protocol === 'https:' && next.protocol === 'http:') {
        fail('download_failed', 'refused to downgrade from https to http following a redirect at ' + current.href);
      }
      current = next;
      continue;
    }
    if (hop.status < 200 || hop.status >= 300) {
      hop.stream.resume();
      fail('download_failed', 'GET ' + current.href + ' failed with HTTP ' + hop.status);
    }
    const body = await readBody(hop.stream);
    emit({
      ok: true,
      headers: {
        contentType: hop.headers['content-type'],
        etag: hop.headers.etag,
        lastModified: hop.headers['last-modified'],
      },
      finalUrl: current.href,
    });
    process.stdout.write(body);
    process.exit(0);
  }
})().catch((error) => {
  fail(error && error.code ? error.code : 'download_failed', error && error.message ? error.message : String(error));
});
`;

/** Headroom over the payload for the envelope line and incidental output. */
const ENVELOPE_HEADROOM_BYTES = 64 * 1024;
