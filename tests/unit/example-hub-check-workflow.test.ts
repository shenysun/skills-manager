import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

/** The one-exit-code hub workflow must run `check` via npx and never pass `--home`. */

const examplePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../examples/github-actions/hub-check.yml');

describe('examples/github-actions/hub-check.yml', () => {
  const doc = parse(readFileSync(examplePath, 'utf8')) as { jobs?: { check?: { steps?: Array<{ run?: string }> } } };

  it('runs skills-manager-cli check via npx, without --home', () => {
    const runs = (doc.jobs?.check?.steps ?? []).map((s) => s.run ?? '').filter(Boolean);
    expect(runs.length).toBe(1);
    expect(runs[0]).toMatch(/npx\s+--yes\s+skills-manager-cli\s+check\b/);
    expect(runs[0]).not.toMatch(/--home\b/);
  });
});
