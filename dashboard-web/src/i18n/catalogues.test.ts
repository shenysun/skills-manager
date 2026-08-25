import { describe, expect, it } from 'vitest';
import zhCN from './zh-CN';
import enUS from './en-US';

function flatten(messages: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object' ? flatten(value as Record<string, unknown>, path) : [path];
  });
}

describe('zh-CN / en-US catalogues', () => {
  it('cover exactly the same keys — no missing, no dead entries', () => {
    expect(flatten(enUS).sort()).toEqual(flatten(zhCN).sort());
  });

  it('never ships an empty message', () => {
    for (const [key, value] of flatten(zhCN)) {
      expect(String(value), key).not.toBe('');
    }
  });
});
