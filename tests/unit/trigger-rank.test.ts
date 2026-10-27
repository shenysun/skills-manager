import { describe, expect, it } from 'vitest';
import { expectSatisfied, rankTriggers, renderTriggerRank, takeTop } from '../../src/core/services/trigger-rank.js';

const hub = [
  { name: 'jest-unit-tests', description: 'Write unit tests with Jest for React components. Use when adding or fixing tests.' },
  { name: 'testing-conventions', description: 'Testing conventions: how to write unit tests with Jest, fixtures and mocks. Use when adding tests.' },
  { name: 'pdf-forms', description: 'Fill and extract PDF form fields.' },
  { name: 'release-notes', description: 'Draft release notes from merged pull requests.' },
];

describe('rankTriggers', () => {
  it('ranks the jest skill first for a jest-specific request', () => {
    const r = rankTriggers('write jest unit tests for a React component', hub);
    expect(r.method).toBe('idf-jaccard');
    expect(r.scanned).toBe(4);
    expect(r.hits[0].skill).toBe('jest-unit-tests');
    expect(r.hits[0].rank).toBe(1);
    expect(r.hits[0].score).toBeGreaterThan(0);
    expect(r.hits[0].shared).toEqual(expect.arrayContaining(['jest']));
  });

  it('ranks pdf-forms first for a PDF request and puts unrelated skills last', () => {
    const r = rankTriggers('fill PDF form fields from a scanned document', hub);
    expect(r.hits[0].skill).toBe('pdf-forms');
    expect(r.hits.map((h) => h.skill).slice(-1)[0]).not.toBe('pdf-forms');
  });

  it('is deterministic and rejects an empty request', () => {
    const a = rankTriggers('draft release notes for the merged PRs', hub);
    const b = rankTriggers('draft release notes for the merged PRs', [...hub].reverse());
    expect(b.hits.map((h) => [h.skill, h.score, h.shared])).toEqual(a.hits.map((h) => [h.skill, h.score, h.shared]));
    expect(() => rankTriggers('   ', hub)).toThrow(/non-empty/);
  });
});

describe('expectSatisfied / takeTop / render', () => {
  it('--expect without --top requires rank 1; with --top allows a window', () => {
    const r = rankTriggers('write unit tests with Jest fixtures and mocks', hub);
    // competing test skills; whichever wins, the other is nearby
    const first = r.hits[0].skill;
    const second = r.hits[1].skill;
    expect(expectSatisfied(r, first).ok).toBe(true);
    expect(expectSatisfied(r, second).ok).toBe(false);
    expect(expectSatisfied(r, second, 2).ok).toBe(true);
    expect(expectSatisfied(r, 'pdf-forms', 2).ok).toBe(false);
  });

  it('takeTop truncates; render mentions PASS/FAIL', () => {
    const r = rankTriggers('fill PDF form fields', hub);
    expect(takeTop(r, 1).hits).toHaveLength(1);
    expect(takeTop(r, 1).hits[0].skill).toBe('pdf-forms');
    expect(renderTriggerRank(r, { expect: 'pdf-forms', top: 1 })).toContain('PASS');
    expect(renderTriggerRank(r, { expect: 'release-notes', top: 1 })).toContain('FAIL');
  });
});
