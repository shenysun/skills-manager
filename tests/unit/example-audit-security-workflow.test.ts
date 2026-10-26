import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/**
 * Copy-paste CI wedge: the example workflow must stay a valid, minimal
 * `audit security --strict --format github` gate and must not pass `--home`
 * (explicit home auto-creates a missing hub → empty scan exits 0).
 */

const examplePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../examples/github-actions/audit-security.yml',
);

describe('examples/github-actions/audit-security.yml', () => {
  const raw = readFileSync(examplePath, 'utf8');
  const doc = parse(raw) as {
    name?: string;
    on?: unknown;
    jobs?: { audit?: { steps?: Array<{ run?: string; uses?: string }> } };
  };

  it('parses as YAML with the expected job shape', () => {
    expect(doc.name).toMatch(/audit security/i);
    expect(doc.on).toBeTruthy();
    expect(doc.jobs?.audit?.steps?.some((s) => s.uses?.startsWith('actions/checkout@'))).toBe(true);
    expect(doc.jobs?.audit?.steps?.some((s) => s.uses?.startsWith('actions/setup-node@'))).toBe(true);
  });

  it('runs audit security --strict --format github via npx, without --home', () => {
    const runs = (doc.jobs?.audit?.steps ?? [])
      .map((s) => s.run ?? '')
      .filter(Boolean);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatch(
      /npx\s+--yes\s+skills-manager-cli\s+audit\s+security\s+--strict\s+--format\s+github\b/,
    );
    expect(runs[0]).not.toMatch(/--home\b/);
  });
});
