import { describe, expect, it } from 'vitest';
import { showUpdateStrip, updatableNames } from './updateStrip';

describe('showUpdateStrip (appears iff updates exist)', () => {
  it('is invisible when nothing is updatable', () => {
    expect(showUpdateStrip(0)).toBe(false);
  });

  it('appears for any positive count', () => {
    expect(showUpdateStrip(1)).toBe(true);
    expect(showUpdateStrip(7)).toBe(true);
  });
});

describe('updatableNames (全部更新 target set)', () => {
  const skills = [
    { name: 'tdd', hasUpdate: true },
    { name: 'grilling', hasUpdate: false },
    { name: 'langfuse', hasUpdate: true },
  ];

  it('collects exactly the rows flagged hasUpdate', () => {
    expect(updatableNames(skills)).toEqual(['tdd', 'langfuse']);
  });

  it('is empty when the library is current', () => {
    expect(updatableNames([{ name: 'tdd', hasUpdate: false }])).toEqual([]);
  });
});
