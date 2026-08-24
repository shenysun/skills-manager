import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractCatalogSnapshot } from '../../src/core/catalog/extract.js';
import { validateCatalogSnapshot } from '../../src/core/catalog/validate-snapshot.js';
import { SkillsManagerError } from '../../src/shared/errors.js';

function upstream(name: string) {
  return readFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'upstream', name), 'utf8');
}

function extract(overrides: Partial<Parameters<typeof extractCatalogSnapshot>[0]> = {}) {
  return extractCatalogSnapshot({
    agentsTs: upstream('agents.ts'),
    detectAgentTs: upstream('detect-agent.ts'),
    commit: 'dd3ca3c85581e593434546a4016fb3a7e7b7f937',
    date: '2026-08-18T20:06:26Z',
    ...overrides,
  });
}

describe('extractCatalogSnapshot', () => {
  it('extracts every upstream agent and the result validates as a snapshot', () => {
    const snapshot = extract();
    expect(snapshot.agents.length).toBeGreaterThanOrEqual(70);
    expect(() => validateCatalogSnapshot(snapshot)).not.toThrow();
  });

  it('stamps the snapshot with the upstream commit, date, and MIT attribution', () => {
    const snapshot = extract();
    expect(snapshot.source.commit).toBe('dd3ca3c85581e593434546a4016fb3a7e7b7f937');
    expect(snapshot.source.date).toBe('2026-08-18T20:06:26Z');
    expect(snapshot.source.license).toBe('MIT');
    expect(snapshot.source.notice).toMatch(/Vercel, Inc\./);
  });

  it('extracts simple home-relative agents', () => {
    const aiderDesk = extract().agents.find((agent) => agent.id === 'aider-desk');
    expect(aiderDesk).toMatchObject({
      label: 'AiderDesk',
      skillsDir: '.aider-desk/skills',
      globalSkillsDir: '~/.aider-desk/skills',
      installProbe: { kind: 'path-exists', path: '~/.aider-desk' },
    });
  });

  it('extracts xdg-variable agents', () => {
    const amp = extract().agents.find((agent) => agent.id === 'amp');
    expect(amp).toMatchObject({ globalSkillsDir: '$configHome/agents/skills', installProbe: { kind: 'path-exists', path: '$configHome/amp' } });
  });

  it('extracts env-variable homes like CODEX_HOME with fallback probes', () => {
    const codex = extract().agents.find((agent) => agent.id === 'codex');
    expect(codex).toMatchObject({
      globalSkillsDir: '$codexHome/skills',
      installProbe: { kind: 'any', conditions: [{ kind: 'path-exists', path: '$codexHome' }, { kind: 'path-exists', path: '/etc/codex' }] },
    });
  });

  it('extracts the project-only agents with null global dir and cwd probes', () => {
    const snapshot = extract();
    expect(snapshot.agents.find((agent) => agent.id === 'eve')).toMatchObject({
      globalSkillsDir: null,
      installProbe: { kind: 'all', conditions: [{ kind: 'cwd-path-exists', path: 'agent' }, { kind: 'cwd-package-dep', package: 'eve' }] },
    });
    expect(snapshot.agents.find((agent) => agent.id === 'promptscript')?.globalSkillsDir).toBeNull();
  });

  it('extracts universal as never-installed', () => {
    expect(extract().agents.find((agent) => agent.id === 'universal')).toMatchObject({ installProbe: { kind: 'never' } });
  });

  it('extracts zed with its optional-variable fallback probes', () => {
    const zed = extract().agents.find((agent) => agent.id === 'zed');
    expect(zed?.installProbe).toEqual({
      kind: 'any',
      conditions: [
        { kind: 'path-exists', path: '$configHome/zed' },
        { kind: 'path-exists', path: '$zedAppDataHome/Zed' },
        { kind: 'path-exists', path: '$zedFlatpakConfigHome/zed' },
      ],
    });
  });

  it('derives env probes from the detect-agent runtime rules with the cursor strong-signal refinement', () => {
    const snapshot = extract();
    expect(snapshot.agents.find((agent) => agent.id === 'claude-code')?.envProbe).toEqual({
      kind: 'any',
      conditions: [
        { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CLAUDECODE' }, { kind: 'env-set', variable: 'CLAUDE_CODE' }] },
        { kind: 'all', conditions: [{ kind: 'env-set', variable: 'CLAUDE_CODE_IS_COWORK' }, { kind: 'any', conditions: [{ kind: 'env-set', variable: 'CLAUDECODE' }, { kind: 'env-set', variable: 'CLAUDE_CODE' }] }] },
      ],
    });
    // cursor: weak TRACE_ID signal is refined away upstream; keep only strong signals.
    expect(snapshot.agents.find((agent) => agent.id === 'cursor')?.envProbe).toEqual({
      kind: 'any',
      conditions: [{ kind: 'env-set', variable: 'CURSOR_AGENT' }, { kind: 'env-value', variable: 'CURSOR_EXTENSION_HOST_ROLE', equals: 'agent-exec' }],
    });
    // codex mirrors the shipped determineAgent if-chain, which has no
    // CODEX_SANDBOX_NETWORK_DISABLED (that variable only exists in the
    // agents.json spec document, not in the runtime).
    expect(snapshot.agents.find((agent) => agent.id === 'codex')?.envProbe).toEqual({
      kind: 'any',
      conditions: [{ kind: 'env-set', variable: 'CODEX_SANDBOX' }, { kind: 'env-set', variable: 'CODEX_CI' }, { kind: 'env-set', variable: 'CODEX_THREAD_ID' }],
    });
    expect(snapshot.agents.find((agent) => agent.id === 'warp')?.envProbe).toBeNull();
  });

  it('keeps the shared ~/.agents/skills family intact', () => {
    const family = extract().agents.filter((agent) => agent.globalSkillsDir === '~/.agents/skills');
    expect(family.map((agent) => agent.id).sort()).toEqual(['cline', 'dexto', 'kimi-code-cli', 'loaf', 'warp', 'zed']);
  });

  it('fails loudly on an upstream detectInstalled shape it cannot translate', () => {
    const mangled = upstream('agents.ts').replace(
      /return existsSync\(join\(home, '\.aider-desk'\)\);/,
      'return new FancyDetector().isPresent();',
    );
    expect(() => extract({ agentsTs: mangled })).toThrowError(SkillsManagerError);
    expect(() => extract({ agentsTs: mangled })).toThrow(/aider-desk/);
  });
});
