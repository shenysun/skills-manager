import { describe, it, expect } from 'vitest';
import { shouldAskFormat } from './formatAsk';

describe('shouldAskFormat', () => {
  it('asks when the payload cannot be auto-identified at all (url_payload_invalid)', () => {
    expect(shouldAskFormat('url_payload_invalid', null)).toBe(true);
  });

  it('asks when the content contradicts the prediction (url_payload_mismatch)', () => {
    expect(shouldAskFormat('url_payload_mismatch', null)).toBe(true);
  });

  it('never re-asks once a format was forced — the escape hatch is once-only', () => {
    expect(shouldAskFormat('url_payload_invalid', 'md')).toBe(false);
    expect(shouldAskFormat('url_payload_mismatch', 'zip')).toBe(false);
  });

  it('stays silent for failures the format cannot fix — network failure', () => {
    expect(shouldAskFormat('download_failed', null)).toBe(false);
  });

  it('stays silent for failures the format cannot fix — unconfirmed plain http', () => {
    expect(shouldAskFormat('insecure_http_unconfirmed', null)).toBe(false);
  });
});
