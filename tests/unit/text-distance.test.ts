import { describe, expect, it } from 'vitest';
import { closestMatches, editDistance } from '../../src/shared/text-distance.js';

/**
 * Pure-function seam for the reference layer's name suggestions (spec
 * provenance-get US21): worked examples pin the edit-distance table and the
 * suggestion cutoff independently of any caller.
 */

describe('editDistance', () => {
  it('counts single-edit fixes (worked examples: one insert, one delete)', () => {
    expect(editDistance('alpa', 'alpha')).toBe(1);
    expect(editDistance('alphaa', 'alpha')).toBe(1);
  });

  it('counts a transposition as two substitutions (plain Levenshtein, no Damerau)', () => {
    // Still within the suggestion cutoff of two — a swapped pair still suggests.
    expect(editDistance('alhpa', 'alpha')).toBe(2);
  });

  it('is case-insensitive (suggestion quality, not exactness)', () => {
    expect(editDistance('ALPHA', 'alpha')).toBe(0);
  });

  it('returns the full distance for unrelated names', () => {
    expect(editDistance('alpha', 'zebra-coder')).toBeGreaterThan(2);
  });
});

describe('closestMatches', () => {
  it('suggests near names, nearest first, capped at three', () => {
    expect(closestMatches('comit', ['commit', 'commits', 'common', 'zebra'])).toEqual(['commit', 'commits']);
  });

  it('drops names beyond two edits', () => {
    expect(closestMatches('completely-different', ['alpha', 'beta'])).toEqual([]);
  });
});
