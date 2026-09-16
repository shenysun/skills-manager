import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { injectFrontmatterMirror, mirrorFieldsForSource, parseSkillFrontmatter } from '../../src/core/services/frontmatter-mirror.js';
import type { SkillSource } from '../../src/core/model/index.js';

/**
 * Pure-function seam of the frontmatter provenance mirror (provenance-get
 * ticket 01, ADR-0017): parse/serialize round-trips that preserve every
 * unknown frontmatter key, and the git-source field projection whose
 * `github-*` block is byte-aligned with gh skill's `InjectGitHubMetadata`.
 */

const CLI_VERSION = '0.0.0-test';

const gitSource = (patch: Partial<SkillSource> = {}): SkillSource => ({
  type: 'git',
  url: 'https://github.com/monalisa/octocat-skills',
  subpath: 'skills/my-skill',
  ref: 'refs/tags/v1.0.0',
  upstream_commit: null,
  upstream_tree: 'tree456',
  ...patch,
});

describe('mirrorFieldsForSource', () => {
  it('projects the four gh-aligned keys plus the tool identity keys for a git source', () => {
    expect(mirrorFieldsForSource(gitSource(), CLI_VERSION)).toEqual({
      'github-repo': 'https://github.com/monalisa/octocat-skills',
      'github-ref': 'refs/tags/v1.0.0',
      'github-tree-sha': 'tree456',
      'github-path': 'skills/my-skill',
      'skills-manager-written-by': 'skills-manager-cli',
      'skills-manager-version': CLI_VERSION,
    });
  });

  it('mirrors github and marketplace sources with the same shape', () => {
    for (const type of ['github', 'marketplace'] as const) {
      const fields = mirrorFieldsForSource(gitSource({ type }), CLI_VERSION);
      expect(Object.keys(fields).filter((key) => key.startsWith('github-'))).toHaveLength(4);
    }
  });

  it('omits keys whose registry value is null instead of writing empty anchors', () => {
    const fields = mirrorFieldsForSource(gitSource({ ref: null, upstream_tree: null }), CLI_VERSION);
    expect(fields).not.toHaveProperty('github-ref');
    expect(fields).not.toHaveProperty('github-tree-sha');
    expect(fields['github-repo']).toBeDefined();
  });

  it('returns null for source kinds that carry no mirror (ADR-0016 parity)', () => {
    for (const type of ['local', 'archive', 'url', 'wellknown'] as const) {
      expect(mirrorFieldsForSource(gitSource({ type }), CLI_VERSION)).toBeNull();
    }
  });

  it('omits the version identity key when the composition root could not read the version', () => {
    const fields = mirrorFieldsForSource(gitSource(), null);
    expect(fields).not.toHaveProperty('skills-manager-version');
    expect(fields?.['skills-manager-written-by']).toBe('skills-manager-cli');
  });
});

describe('parseSkillFrontmatter round-trip', () => {
  it('parses frontmatter and body, and survives a serialize round-trip byte-for-byte', () => {
    const text = '---\nname: my-skill\ndescription: desc\n---\n# Body\n';
    const parsed = parseSkillFrontmatter(text);
    expect(parsed.data).toEqual({ name: 'my-skill', description: 'desc' });
    expect(parsed.body).toBe('# Body\n');
    expect(injectFrontmatterMirror(text, null)).toBe(text);
  });

  it('treats frontmatter-less content as an empty document with a full body', () => {
    const parsed = parseSkillFrontmatter('# Body only\n');
    expect(parsed.data).toEqual({});
    expect(parsed.body).toBe('# Body only\n');
  });
});

describe('injectFrontmatterMirror', () => {
  it('emits the gh-skill metadata block byte-aligned with the cli/cli contract fixture', () => {
    // The expected lines come from cli/cli's TestInjectGitHubMetadata
    // ("injects metadata without pin"): our projected block must match them
    // verbatim, including yaml.v3's four-space nesting indent.
    const input = '---\nname: my-skill\ndescription: desc\n---\n# Body\n';
    const output = injectFrontmatterMirror(input, mirrorFieldsForSource(gitSource(), CLI_VERSION));
    expect(output).toContain('metadata:\n    github-path: skills/my-skill\n    github-ref: refs/tags/v1.0.0\n    github-repo: https://github.com/monalisa/octocat-skills\n    github-tree-sha: tree456\n');
    expect(output).toContain('# Body');
    expect(output).not.toContain('github-owner');
    expect(output).not.toContain('github-sha');
    expect(output).not.toContain('github-pinned');
  });

  it('matches the repo URL regardless of a .git suffix or tree-rest normalization — the registry value passes through verbatim', () => {
    const fields = mirrorFieldsForSource(gitSource({ url: 'https://github.com/monalisa/octocat-skills.git' }), CLI_VERSION);
    expect(fields['github-repo']).toBe('https://github.com/monalisa/octocat-skills.git');
  });

  it('preserves unknown frontmatter keys, including keys gh skill wrote (US15)', () => {
    const input = [
      '---',
      'name: my-skill',
      'description: desc',
      'allowed-tools: Bash, Read',
      'metadata:',
      '    local-path: /home/monalisa/skills/my-skill',
      '    version: 3',
      '---',
      '# Body',
      '',
    ].join('\n');
    const output = injectFrontmatterMirror(input, mirrorFieldsForSource(gitSource(), CLI_VERSION));
    expect(output).toContain('allowed-tools: Bash, Read');
    expect(output).toContain('local-path: /home/monalisa/skills/my-skill');
    expect(output).toContain('version: 3');
    // And the whole document still parses with every key accounted for.
    const reparsed = parseSkillFrontmatter(output);
    expect(reparsed.data['allowed-tools']).toBe('Bash, Read');
    expect((reparsed.data.metadata as Record<string, unknown>)['local-path']).toBe('/home/monalisa/skills/my-skill');
    expect((reparsed.data.metadata as Record<string, unknown>)['github-tree-sha']).toBe('tree456');
    expect(reparsed.body).toBe('# Body\n');
  });

  it('replaces owned keys wholesale on reprojection and is idempotent (no diff noise)', () => {
    const input = '---\nname: my-skill\ndescription: desc\n---\n# Body\n';
    const first = injectFrontmatterMirror(input, mirrorFieldsForSource(gitSource(), CLI_VERSION));
    const dirtied = first.replace('tree456', 'tampered');
    const reprojected = injectFrontmatterMirror(dirtied, mirrorFieldsForSource(gitSource(), CLI_VERSION));
    expect(reprojected).toBe(first);
    expect(injectFrontmatterMirror(first, mirrorFieldsForSource(gitSource(), CLI_VERSION))).toBe(first);
  });

  it('creates frontmatter for body-only content the way gh skill does', () => {
    const output = injectFrontmatterMirror('# Body only\n', mirrorFieldsForSource(gitSource({ ref: 'refs/heads/main' }), CLI_VERSION));
    expect(output.startsWith('---\n')).toBe(true);
    expect(output).toContain('github-ref: refs/heads/main');
    expect(output).toContain('# Body only');
    expect(output.endsWith('# Body only\n')).toBe(true);
  });

  it('leaves the file untouched when there is no mirror to write', () => {
    const input = '---\nname: my-skill\nmetadata:\n    local-path: /somewhere\n---\n# Body\n';
    expect(injectFrontmatterMirror(input, null)).toBe(input);
  });
});

describe('gh skill contract fixture', () => {
  // The fixture is the verbatim input document from cli/cli's
  // TestInjectGitHubMetadata ("injects metadata without pin"); the expected
  // lines below are that test's wantContains entries, copied verbatim.
  const GH_WANT_CONTAINS = [
    'github-repo: https://github.com/monalisa/octocat-skills',
    'github-ref: refs/tags/v1.0.0',
    'github-tree-sha: tree456',
    'github-path: skills/my-skill',
    '# Body',
  ];

  const loadFixture = () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(here, '..', 'fixtures', 'gh-skill-metadata-fixture.md'), 'utf8');
  };

  it('projects the four keys onto the fixture, byte-aligned with gh skill (forward contract)', () => {
    const output = injectFrontmatterMirror(loadFixture(), mirrorFieldsForSource(gitSource(), CLI_VERSION));
    for (const line of GH_WANT_CONTAINS) expect(output).toContain(line);
    expect(output).not.toContain('github-owner');
    expect(output).not.toContain('github-sha');
    expect(output).not.toContain('github-pinned');
  });

  it('feeds the same projection back through the parser (reverse contract, reader itself is ticket 05)', () => {
    const output = injectFrontmatterMirror(loadFixture(), mirrorFieldsForSource(gitSource(), CLI_VERSION));
    const reparsed = parseSkillFrontmatter(output);
    const metadata = reparsed.data.metadata as Record<string, string>;
    expect(metadata['github-repo']).toBe('https://github.com/monalisa/octocat-skills');
    expect(metadata['github-ref']).toBe('refs/tags/v1.0.0');
    expect(metadata['github-tree-sha']).toBe('tree456');
    expect(metadata['github-path']).toBe('skills/my-skill');
    expect(reparsed.data.name).toBe('my-skill');
    expect(reparsed.body).toBe('# Body\n');
  });
});
