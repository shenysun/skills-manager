import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTICE_TTL_MS, expireNotice, idleNotice, showNotice } from './noticeSlot';

describe('notice single-slot policy', () => {
  it('show replaces the previous notice instead of stacking', () => {
    const first = showNotice(idleNotice, 'ok', 'installed tdd', 1_000);
    const second = showNotice(first, 'error', 'remove failed', 1_500);
    expect(second.notice).toEqual({ kind: 'error', text: 'remove failed' });
    expect(second.notice).not.toEqual(first.notice);
  });

  it('TTL is injectable; the default is about 4 seconds', () => {
    const shown = showNotice(idleNotice, 'ok', 'updated tdd', 10_000, 250);
    expect(expireNotice(shown, 10_249).notice).toEqual({ kind: 'ok', text: 'updated tdd' });
    expect(expireNotice(shown, 10_250).notice).toBeNull();

    const product = showNotice(idleNotice, 'ok', 'distributed', 0);
    expect(product.dismissAt).toBe(DEFAULT_NOTICE_TTL_MS);
    expect(DEFAULT_NOTICE_TTL_MS).toBe(4000);
  });

  it('expiring an empty slot stays empty', () => {
    expect(expireNotice(idleNotice, 9_999)).toEqual(idleNotice);
  });
});
