import { afterEach, describe, expect, it } from 'vitest';
import type { DownloadRequest } from '../../src/core/ports/http-download.js';
import { HttpDownloadClient } from '../../src/infra/http-download-client.js';
import { skillMarkdown } from '../fixtures/archives.js';
import { closeWireServers, serveWire, TEST_CA_PEM } from '../fixtures/wire-http.js';

/**
 * The real HTTP download adapter against wire-real local servers (spec
 * source-formats, Testing Decisions): redirects, socket timeouts, the
 * on-stream size limit and header exposure are verified against actual TCP
 * behavior, with the ruled bounds injected small so every branch runs in
 * milliseconds. The servers run on worker threads — see wire-http.ts for why
 * the main thread cannot host them under a synchronous port.
 */

const SKILL_BODY = skillMarkdown('alpha', 'from the wire');

afterEach(closeWireServers);

const LOOSE: DownloadRequest = { maxBytes: 1024 * 1024, maxRedirects: 5, connectTimeoutMs: 2_000, idleTimeoutMs: 2_000 };

describe('HttpDownloadClient (real adapter, local servers)', () => {
  it('downloads a payload and exposes its headers and final URL', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: SKILL_BODY });
    const result = new HttpDownloadClient().download(`${baseUrl}/SKILL.md`, LOOSE);
    expect(result.bytes.toString('utf8')).toBe(SKILL_BODY);
    expect(result.headers).toEqual({ contentType: 'text/markdown', etag: '"v1"', lastModified: 'Wed, 09 Sep 2026 10:00:00 GMT' });
    expect(result.finalUrl).toBe(`${baseUrl}/SKILL.md`);
  });

  it('follows redirects (resolving relative Locations) and reports the final URL', async () => {
    const baseUrl = await serveWire({
      kind: 'chain',
      routes: { '/start': { status: 302, location: '/middle' }, '/middle': { status: 302, location: '/SKILL.md' } },
      body: SKILL_BODY,
    });
    const result = new HttpDownloadClient().download(`${baseUrl}/start`, LOOSE);
    expect(result.bytes.toString('utf8')).toBe(SKILL_BODY);
    expect(result.finalUrl).toBe(`${baseUrl}/SKILL.md`);
  });

  it('downloads over https, handshake included in the connect bound', async () => {
    const baseUrl = await serveWire({ kind: 'file', body: SKILL_BODY }, { tls: true });
    const result = new HttpDownloadClient({ ca: TEST_CA_PEM }).download(`${baseUrl}/SKILL.md`, LOOSE);
    expect(result.bytes.toString('utf8')).toBe(SKILL_BODY);
    expect(result.headers.etag).toBe('"v1"');
  });

  it('refuses an https-to-http redirect downgrade before following it (US-12)', async () => {
    const baseUrl = await serveWire({ kind: 'downgrade' }, { tls: true });
    let thrown: Error | undefined;
    try {
      new HttpDownloadClient({ ca: TEST_CA_PEM }).download(`${baseUrl}/start`, LOOSE);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe('download_failed');
    expect(thrown?.message).toMatch(/https to http/);
  });

  it('refuses the sixth redirect', async () => {
    const baseUrl = await serveWire({ kind: 'loop-redirect' });
    expect(() => new HttpDownloadClient().download(`${baseUrl}/0`, LOOSE)).toThrow(
      expect.objectContaining({ code: 'download_redirect_limit' }),
    );
  });

  it('surfaces a non-2xx outcome as a transport failure naming the status', async () => {
    const baseUrl = await serveWire({ kind: 'status', status: 404 });
    let thrown: Error | undefined;
    try {
      new HttpDownloadClient().download(`${baseUrl}/SKILL.md`, LOOSE);
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string }).code).toBe('download_failed');
    expect(thrown?.message).toMatch(/404/);
  });

  it('fails a stalled connection with download_connect_timeout', () => {
    // 192.0.2.0/24 is RFC 5737 documentation space — never routable, so the
    // connect attempt can only ever end by timeout.
    const request = { ...LOOSE, connectTimeoutMs: 300, idleTimeoutMs: 5_000 };
    expect(() => new HttpDownloadClient().download('http://192.0.2.1:9/SKILL.md', request)).toThrow(
      expect.objectContaining({ code: 'download_connect_timeout' }),
    );
  });

  it('fails a server that accepts but never responds with download_idle_timeout', async () => {
    const baseUrl = await serveWire({ kind: 'silent' });
    const request = { ...LOOSE, connectTimeoutMs: 2_000, idleTimeoutMs: 300 };
    expect(() => new HttpDownloadClient().download(`${baseUrl}/SKILL.md`, request)).toThrow(
      expect.objectContaining({ code: 'download_idle_timeout' }),
    );
  });

  it('lets a slow-but-progressing body finish — no total cap, only idle bounds (US-13)', async () => {
    const baseUrl = await serveWire({ kind: 'drip', ticks: 8, everyMs: 100 });
    const request = { ...LOOSE, idleTimeoutMs: 300 };
    const result = new HttpDownloadClient().download(`${baseUrl}/SKILL.md`, request);
    expect(result.bytes.toString('utf8')).toBe('x'.repeat(7));
  });

  it('aborts the download the moment the payload exceeds maxBytes (on-stream enforcement)', async () => {
    const baseUrl = await serveWire({ kind: 'blob', size: 2048 });
    const request = { ...LOOSE, maxBytes: 64 };
    expect(() => new HttpDownloadClient().download(`${baseUrl}/SKILL.md`, request)).toThrow(
      expect.objectContaining({ code: 'download_size_exceeded' }),
    );
  });
});
