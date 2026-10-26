import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** Copy-paste routing CI: must run `trigger test … --expect` via npx and never pass `--home`. */

const examplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples/github-actions/trigger-test.yml',
);

describe('examples/github-actions/trigger-test.yml', () => {
  const raw = readFileSync(examplePath, 'utf8');
  const doc = parse(raw) as {
    name?: string;
    on?: unknown;
    jobs?: { trigger?: { steps?: Array<{ run?: string; uses?: string }> } };
  };

  it('parses as YAML with the expected job shape', () => {
    expect(doc.name).toMatch(/trigger test/i);
    expect(doc.on).toBeTruthy();
    expect(doc.jobs?.trigger?.steps?.some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(true);
    expect(doc.jobs?.trigger?.steps?.some((s) => s.uses?.startsWith('actions/setup-node@'))).toBe(true);
  });

  it('runs several trigger test --expect assertions via npx, without --home', () => {
    const runs = (doc.jobs?.trigger?.steps ?? []).map((s) => s.run ?? '').filter(Boolean);
    expect(runs.length).toBe(1);
    const run = runs[0];
    expect(run).toMatch(/npx\s+--yes\s+skills-manager-cli\s+trigger\s+test\b/);
    expect(run).toMatch(/--expect\s+pdf-forms\b/);
    expect(run).toMatch(/--expect\s+release-notes\b/);
    expect(run).toMatch(/--expect\s+testing-conventions\b/);
    expect(run).toMatch(/--top\s+2\b/);
    expect(run).not.toMatch(/--home\b/);
    // At least three assertions so the copy-paste file is a real starting point.
    expect((run.match(/skills-manager-cli\s+trigger\s+test/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
