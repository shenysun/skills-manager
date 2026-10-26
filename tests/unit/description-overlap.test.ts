import { describe, expect, it } from 'vitest';
import { descriptionTerms, findDescriptionOverlaps, renderOverlapReport } from '../../src/core/services/description-overlap.js';

const hub = [
  { name: 'jest-unit-tests', description: 'Write unit tests with Jest for React components. Use when adding or fixing tests.' },
  { name: 'testing-conventions', description: 'Testing conventions: how to write unit tests with Jest, fixtures and mocks. Use when adding tests.' },
  { name: 'pdf-forms', description: 'Fill and extract PDF form fields.' },
  { name: 'release-notes', description: 'Draft release notes from merged pull requests.' },
];

describe('descriptionTerms', () => {
  it('drops stopwords and short words, strips plurals, keeps CJK bigrams', () => {
    const t = descriptionTerms('Use this skill when writing tests for 前端组件');
    expect([...t]).toEqual(expect.arrayContaining(['writing', 'test', '前端', '端组', '组件']));
    expect(t.has('use')).toBe(false);
    expect(t.has('skill')).toBe(false);
  });
});

describe('findDescriptionOverlaps', () => {
  it('flags the competing test skills and nothing else', () => {
    const r = findDescriptionOverlaps(hub, 0.3);
    expect(r.scanned).toBe(4);
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([['jest-unit-tests', 'testing-conventions']]);
    expect(r.pairs[0].shared).toEqual(expect.arrayContaining(['jest', 'unit', 'test']));
    expect(r.pairs[0].suggestion).toContain('testing-conventions');
  });

  it('is deterministic and order-independent', () => {
    const a = findDescriptionOverlaps(hub, 0.3);
    const b = findDescriptionOverlaps([...hub].reverse(), 0.3);
    expect(b).toEqual(a);
  });

  it('threshold 1 reports only identical descriptions; empty descriptions never pair', () => {
    const r = findDescriptionOverlaps([
      { name: 'a', description: 'Deploy previews on Vercel' },
      { name: 'b', description: 'Deploy previews on Vercel' },
      { name: 'c', description: '' },
    ], 1);
    expect(r.pairs.map((p) => [p.a, p.b])).toEqual([['a', 'b']]);
  });

  it('rejects a threshold outside 0..1', () => {
    expect(() => findDescriptionOverlaps(hub, 2)).toThrow(/0\.\.1/);
  });

  it('renders a readable report', () => {
    expect(renderOverlapReport(findDescriptionOverlaps(hub, 0.3))).toMatch(/jest-unit-tests ↔ testing-conventions/);
    expect(renderOverlapReport(findDescriptionOverlaps(hub, 0.99))).toMatch(/none/);
  });
});
