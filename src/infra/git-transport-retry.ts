/**
 * Classification of git transport failures for the HTTP/1.1 retry (ticket 02, ADR-0013).
 *
 * Network-class signatures come from the 2026-09-08 batch-update deaths (`curl 92`
 * HTTP/2 stream teardown, `curl 56` connection reset) plus the other transport-level
 * failure wordings git emits when the pack stream is cut off. A retry is attempted
 * only when one of these matches — anything else (missing repo, auth, missing ref)
 * is deterministic and fails again on HTTP/1.1.
 */
export const NETWORK_TRANSPORT_ERROR_PATTERNS: readonly RegExp[] = [
  /curl (92|56)\b/i,
  /HTTP\/2 stream/i,
  /connection reset/i,
  /connection was reset/i,
  /RPC failed/i,
  /early EOF/i,
  /fetch-pack/i,
];

/**
 * Deterministic failures an HTTP/1.1 retry can never fix. They win over the network
 * list when both match (e.g. `RPC failed; HTTP 401 curl 22 … returned error: 401`).
 */
export const DETERMINISTIC_ERROR_PATTERNS: readonly RegExp[] = [
  /Repository not found/i,
  /Authentication failed/i,
  /returned error: 40[134]/i,
  /Remote branch .+ not found in upstream/i,
  /couldn't find remote ref/i,
];

/** In-process git config-count injection forcing HTTP/1.1 — never touches any gitconfig file. */
export const HTTP1_RETRY_ENV: Readonly<Record<string, string>> = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'http.version',
  GIT_CONFIG_VALUE_0: 'HTTP/1.1',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the failure is transport-level network noise worth exactly one HTTP/1.1 retry. */
export function isRetryableTransportFailure(error: unknown): boolean {
  const text = errorText(error);
  if (DETERMINISTIC_ERROR_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return NETWORK_TRANSPORT_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}
