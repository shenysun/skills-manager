import { describe, expect, it } from 'vitest';
import { charApproxTokens } from '../../src/core/services/cost-ledger-service.js';

/**
 * char-approx (ADR-0018): CJK characters count 1 token each, all other
 * characters divide by 4. Expected values below are worked by hand from that
 * rule — zh descriptions like this repo's own skills are the primary case.
 */
describe('charApproxTokens', () => {
  it('counts pure ASCII at 4 chars per token', () => {
    // 11 non-CJK characters (space included) -> floor(11/4) = 2
    expect(charApproxTokens('hello world')).toBe(2);
  });

  it('counts every CJK character as one token', () => {
    expect(charApproxTokens('你好世界')).toBe(4);
  });

  it('blends CJK and ASCII in one string', () => {
    // 2 CJK + 6 others (' world') -> 2 + floor(6/4) = 3
    expect(charApproxTokens('你好 world')).toBe(3);
  });

  it('counts whitespace as other characters (÷4)', () => {
    expect(charApproxTokens('    ')).toBe(1);
    expect(charApproxTokens('   ')).toBe(0);
  });

  it('treats fullwidth punctuation, kana, and CJK punctuation as CJK', () => {
    // ！ (U+FF01 fullwidth), 。(U+3002 CJK punctuation), あ (U+3042 hiragana)
    expect(charApproxTokens('！。あ')).toBe(3);
  });

  it('returns 0 for the empty string', () => {
    expect(charApproxTokens('')).toBe(0);
  });

  it('sizes a realistic zh description the way the ledger will use it', () => {
    // name 'commit' -> floor(6/4) = 1
    expect(charApproxTokens('commit')).toBe(1);
    // '提交代码变更到 git 仓库': 9 CJK + 5 others -> 9 + 1 = 10
    expect(charApproxTokens('提交代码变更到 git 仓库')).toBe(10);
  });
});
