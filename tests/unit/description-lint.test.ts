import { describe, expect, it } from 'vitest';
import { lintDescription, lintDescriptions, renderDescriptionLint } from '../../src/core/services/description-lint.js';

const rules = (name: string, d?: string) => lintDescription(name, d).findings.map((f) => f.rule);

describe('lintDescription', () => {
  it('passes the Anthropic best-practice example', () => {
    const r = lintDescription('pdf-processing', 'Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.');
    expect(r.findings).toEqual([]);
    expect(r.score).toBe(100);
  });

  it('flags a missing description as an error', () => {
    expect(lintDescription('x', '').findings).toMatchObject([{ rule: 'missing', severity: 'error' }]);
  });

  it('flags the doc\'s vague example: vague + no trigger', () => {
    expect(rules('docs', 'Helps with documents')).toEqual(['no-trigger', 'vague']);
  });

  it('flags over-long descriptions and XML tags as errors', () => {
    expect(rules('long', `Use when parsing logs. ${'word '.repeat(220)}`)).toContain('too-long');
    expect(rules('tag', 'Use when rendering <b>bold</b> charts from CSV, JSON and Parquet files.')).toContain('xml-tag');
  });

  it('flags first/second person openings', () => {
    expect(rules('xl', 'I can help you process Excel spreadsheets and pivot tables. Use when analyzing .xlsx files.')).toContain('point-of-view');
    expect(rules('xl', 'You can use this to process Excel spreadsheets. Use when analyzing .xlsx files.')).toContain('point-of-view');
    expect(rules('xl', 'Processes Excel spreadsheets and pivot tables. Use when you analyze .xlsx files.')).not.toContain('point-of-view');
  });

  it('enforces name rules (lowercase-hyphen, ≤ 64, no reserved words)', () => {
    expect(rules('My_Skill', 'Use when testing names with uppercase underscores and more words.')).toContain('name-format');
    expect(rules('claude-helper', 'Use when testing names with reserved words in them, fine otherwise.')).toContain('name-format');
    expect(rules('a'.repeat(65), 'Use when testing names that are far too long for the spec limit.')).toContain('name-format');
  });

  it('recognises Chinese trigger phrasing', () => {
    expect(rules('git-flow', '在本仓库中，只要需要管理 Git 分支、合并代码、推送远端，就必须使用本 skill。')).not.toContain('no-trigger');
    expect(rules('zh', '生成周报和月报的数据图表，当用户提到周报时使用。')).not.toContain('no-trigger');
  });
});

describe('lintDescriptions', () => {
  it('sorts worst first, counts errors/warnings, renders', () => {
    const r = lintDescriptions([
      { name: 'good', description: 'Generate commit messages by analyzing git diffs. Use when the user asks for help writing commit messages.' },
      { name: 'empty', description: '' },
      { name: 'meh', description: 'Processes data' },
    ]);
    expect(r.skills.map((s) => s.skill)).toEqual(['empty', 'meh', 'good']);
    expect([r.errors, r.warnings]).toEqual([1, 2]);
    const text = renderDescriptionLint(r);
    expect(text).toContain('1 error(s), 2 warning(s), 1 clean');
    expect(text).toContain('ERROR missing');
  });
});
