import { describe, expect, it } from 'vitest';
import { NETWORK_TRANSPORT_ERROR_PATTERNS, isRetryableTransportFailure } from '../../src/infra/git-transport-retry.js';

const URL = 'https://github.com/owner/repo.git';

/** Real-world signatures observed on 2026-09-08 batch updates plus canonical git output shapes. */
const SAMPLES: ReadonlyArray<{ text: string; retryable: boolean }> = [
  {
    text: `Command failed: git clone --depth=1 ${URL} /tmp/repo\nfatal: unable to access '${URL}/': curl 92 HTTP/2 stream 0 was not closed cleanly: BEFORE_STREAM (err 99)`,
    retryable: true,
  },
  {
    text: `Command failed: git -C /tmp/repo fetch --depth=1 origin 0123\nerror: RPC failed; curl 56 Recv failure: Connection reset by peer`,
    retryable: true,
  },
  {
    text: `fatal: unable to access '${URL}/': OpenSSL SSL_read: Connection was reset by peer, errno 104`,
    retryable: true,
  },
  { text: 'error: RPC failed; curl 56 GnuTLS recv error (-54): Error in the pull function.', retryable: true },
  { text: 'fatal: early EOF', retryable: true },
  { text: 'fatal: fetch-pack: invalid index-pack output', retryable: true },
  { text: 'error: RPC failed; HTTP 502 curl 22 The requested URL returned error: 502', retryable: true },
  { text: 'ERROR: Repository not found.\nfatal: Could not read from remote repository.', retryable: false },
  { text: `fatal: unable to access '${URL}/': The requested URL returned error: 404`, retryable: false },
  { text: `remote: HTTP Basic: Access denied\nfatal: Authentication failed for '${URL}/'`, retryable: false },
  { text: `fatal: unable to access '${URL}/': The requested URL returned error: 403`, retryable: false },
  { text: 'fatal: Remote branch nope not found in upstream origin', retryable: false },
  { text: "fatal: couldn't find remote ref refs/heads/nope", retryable: false },
  { text: 'error: RPC failed; HTTP 401 curl 22 The requested URL returned error: 401', retryable: false },
  { text: 'Command failed: git init /tmp/repo\nfatal: could not create work tree', retryable: false },
];

describe('isRetryableTransportFailure (network vs deterministic signatures)', () => {
  it.each(SAMPLES)('$text', ({ text, retryable }) => {
    expect(isRetryableTransportFailure(new Error(text))).toBe(retryable);
  });

  it('accepts non-Error failures by stringifying them', () => {
    expect(isRetryableTransportFailure('fatal: early EOF')).toBe(true);
    expect(isRetryableTransportFailure('fatal: Remote branch nope not found in upstream origin')).toBe(false);
  });

  it('keeps deterministic failures non-retryable even when mixed with network wording', () => {
    const mixed = 'error: RPC failed; HTTP 404 curl 22 The requested URL returned error: 404';
    expect(NETWORK_TRANSPORT_ERROR_PATTERNS.some((pattern) => pattern.test(mixed))).toBe(true);
    expect(isRetryableTransportFailure(new Error(mixed))).toBe(false);
  });
});
