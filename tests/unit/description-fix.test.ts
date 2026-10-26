import { describe, expect, it } from 'vitest';
import { boundaryProposals, fixDescription, fixDescriptions, replaceFrontmatterDescription } from '../../src/core/services/description-fix.js';
import { lintDescription } from '../../src/core/services/description-lint.js';

describe('fixDescription', () => {
  it('appends a trigger clause that clears no-trigger', () => {
    const p = fixDescription('pdf-forms', 'Fills PDF forms and extracts fields from scanned invoices.');
    expect(p.applied).toEqual(['no-trigger']);
    expect(p.after).toMatch(/^Fills PDF forms and extracts fields from scanned invoices\. Use when the user mentions .+, or asks for pdf forms\.$/);
    expect(lintDescription('pdf-forms', p.after).findings.map((f) => f.rule)).not.toContain('no-trigger');
  });

  it('rewrites first/second person to third person and strips tags', () => {
    const p = fixDescription('csv-tools', 'I can convert <b>CSV</b> files to Parquet. Use when the user asks to convert spreadsheets.');
    expect(p.applied).toEqual(['xml-tag', 'point-of-view']);
    expect(p.after).toBe('Convert CSV files to Parquet. Use when the user asks to convert spreadsheets.');
  });

  it('trims to 1024 chars at a sentence boundary and keeps the trigger', () => {
    const long = `${'Parses large log archives. '.repeat(60)}Use when the user asks about logs.`;
    const p = fixDescription('log-parse', long);
    expect(p.applied).toContain('too-long');
    expect(p.after.length).toBeLessThanOrEqual(1024);
    expect(p.after).toMatch(/archives\. Use when the user asks about logs\.$/);
  });

  it('never invents a missing description and flags manual rules', () => {
    const p = fixDescription('claude-x', '');
    expect(p.after).toBe('');
    expect(p.manual).toEqual(['missing', 'name-format']);
  });

  it('is deterministic and skips clean skills', () => {
    const skills = [
      { name: 'clean', description: 'Formats release notes from merged pull requests. Use when cutting a release.' },
      { name: 'weak', description: 'Converts Markdown tables into styled HTML reports.' },
    ];
    expect(fixDescriptions(skills)).toEqual(fixDescriptions(skills));
    expect(fixDescriptions(skills).map((p) => p.skill)).toEqual(['weak']);
  });
});

describe('boundaryProposals', () => {
  const skills = [
    { name: 'grill-me', description: 'A relentless interview to sharpen a plan or design.' },
    { name: 'grill-with-docs', description: "A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go." },
    { name: 'pdf', description: 'Fill PDF forms. Use when the user sends a PDF.' },
  ];

  it('adds a boundary line to each side of a competing pair', () => {
    const out = boundaryProposals(skills);
    expect(out.map((p) => p.skill)).toEqual(['grill-me', 'grill-with-docs']);
    expect(out[0].after).toMatch(/ For .*(glossary|adr|docs).*, use the grill-with-docs skill instead\.$/);
    expect(out[1].after).toMatch(/ For the same job without .+, use the grill-me skill instead\.$/);
  });

  it('is idempotent once the boundary is written', () => {
    const written = boundaryProposals(skills).map((p) => ({ name: p.skill, description: p.after }));
    const again = boundaryProposals([...written, skills[2]], 0.3);
    for (const p of again) expect(p.after.match(/skill instead/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe('replaceFrontmatterDescription', () => {
  it('replaces only the description, including a folded multi-line one', () => {
    const text = '---\nname: a\ndescription: >\n  old line one\n  old line two\nlicense: MIT\n---\n# Body\n';
    expect(replaceFrontmatterDescription(text, 'New: text. Use when x.')).toBe('---\nname: a\ndescription: "New: text. Use when x."\nlicense: MIT\n---\n# Body\n');
  });

  it('adds the key when absent and refuses a file without frontmatter', () => {
    expect(replaceFrontmatterDescription('---\nname: a\n---\nbody', 'Hi there')).toBe('---\nname: a\ndescription: Hi there\n---\nbody');
    expect(() => replaceFrontmatterDescription('# no fm', 'x')).toThrow(/frontmatter/);
  });
});
