/**
 * Add-wizard format escape hatch (source-formats ticket 09, US-5/30): the
 * format selector appears only when the payload could not be auto-identified —
 * a prediction the content contradicts (`url_payload_mismatch`) or a verdict
 * that never materialized (`url_payload_invalid`). Any other failure explains
 * itself, and a retry with a forced format is final: the selector never
 * re-asks, mirroring the CLI's once-only `--format` flag.
 */
import type { UrlPayloadFormat } from '../api/client';

const FORMAT_ASK_CODES: ReadonlySet<string> = new Set(['url_payload_mismatch', 'url_payload_invalid']);

export function shouldAskFormat(code: string, forcedFormat: UrlPayloadFormat | null): boolean {
  return forcedFormat === null && FORMAT_ASK_CODES.has(code);
}
