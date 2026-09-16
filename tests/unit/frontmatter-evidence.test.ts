import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { frontmatterToSource } from '../../src/core/services/frontmatter-evidence.js';
import { injectFrontmatterMirror, mirrorFieldsForSource } from '../../src/core/services/frontmatter-mirror.js';
import type { SkillSource } from '../../src/core/model/index.js';

/**
 * Pure-function seam of the frontmatter evidence reader (provenance-get
 * ticket 05, ADR-0017): a SKILL.md's `metadata:` block maps back onto
 * registry-shaped source evidence — gh skill's `github-*` vocabulary and our
 * own `skills-manager-*` anchors — and the projector's own output reads back
 * into equivalent evidence (round-trip fidelity, US 前提).
 */

const CLI_VERSION = '0.0.0-test';

const aSource = (patch: Partial<SkillSource> = {}): SkillSource => ({
  type: 'git',
  url: 'https://github.com/monalisa/octocat-skills',
  subpath: 'skills/my-skill',
  ref: 'refs/tags/v1.0.0',
  upstream_commit: null,
  upstream_tree: 'tree456',
  ...patch,
});

/** gh skill's own writer output shape: four keys, no skills-manager identity. */
const ghWritten = (patch: Record<string, string> = {}) =>
  `---\nname: my-skill\ndescription: desc\nmetadata:\n    github-repo: https://github.com/monalisa/octocat-skills\n    github-ref: refs/tags/v1.0.0\n    github-tree-sha: tree456\n    github-path: skills/my-skill\n${Object.entries(patch).map(([k, v]) => `    ${k}: ${v}\n`).join('')}---\n# Body\n`;

describe('frontmatterToSource: github-* namespace (gh skill interop)', () => {
  it('maps the gh-written four keys onto registry evidence, gh identity or none', () => {
    // Without any skills-manager identity keys — exactly what gh skill leaves.
    const evidence = frontmatterToSource(ghWritten());
    expect(evidence).toEqual({
      type: 'github',
      url: 'https://github.com/monalisa/octocat-skills',
      subpath: 'skills/my-skill',
      ref: 'refs/tags/v1.0.0',
      upstream_tree: 'tree456',
    });
  });

  it('treats adjacent skills-manager identity keys as freshness signals, not mapping inputs', () => {
    const evidence = frontmatterToSource(ghWritten({ 'skills-manager-written-by': 'skills-manager-cli' }));
    expect(evidence).toMatchObject({ url: 'https://github.com/monalisa/octocat-skills', upstream_tree: 'tree456' });
  });

  it('maps host github.com to type github, everything else to type git (ADR-0017)', () => {
    expect(frontmatterToSource(ghWritten())).toMatchObject({ type: 'github' });
    // *.ghe.com walks the generic non-GitHub detection path.
    const ghec = frontmatterToSource(ghWritten().replace('github.com', 'acme.ghe.com'));
    expect(ghec).toMatchObject({ type: 'git', url: expect.stringContaining('acme.ghe.com') });
    const gitlab = frontmatterToSource(ghWritten().replace('https://github.com/monalisa/octocat-skills', 'https://gitlab.com/monalisa/octocat-skills'));
    expect(gitlab).toMatchObject({ type: 'git' });
    // Our own file:// installs keep their kind through the round trip.
    const localFile = frontmatterToSource(ghWritten().replace('https://github.com/monalisa/octocat-skills', 'file:///tmp/upstream'));
    expect(localFile).toMatchObject({ type: 'git' });
  });

  it('is evidence-as-calibration: tree-sha lands as upstream_tree, absent keys stay null', () => {
    const unpinned = frontmatterToSource(`---\nname: my-skill\nmetadata:\n    github-repo: https://github.com/monalisa/octocat-skills\n    github-path: skills/my-skill\n---\n# Body\n`);
    expect(unpinned).toEqual({
      type: 'github',
      url: 'https://github.com/monalisa/octocat-skills',
      subpath: 'skills/my-skill',
      ref: null,
      upstream_tree: null,
    });
  });

  it('maps a root-anchored path to subpath null — the registry word for repo root', () => {
    const rootPath = frontmatterToSource(`---\nname: my-skill\nmetadata:\n    github-repo: https://github.com/monalisa/octocat-skills\n    github-path: ''\n---\n# Body\n`);
    expect(rootPath).toMatchObject({ subpath: null });
    const dotPath = frontmatterToSource(ghWritten().replace('github-path: skills/my-skill', "github-path: '.'"));
    expect(dotPath).toMatchObject({ subpath: null });
  });
});

describe('frontmatterToSource: skills-manager-* namespace (round-trip fidelity)', () => {
  it('digest names wellknown evidence: index URL + declared digest', () => {
    const mirrored = injectFrontmatterMirror('---\nname: s\n---\n# Body\n', mirrorFieldsForSource(aSource({
      type: 'wellknown',
      url: 'https://example.com/.well-known/agent-skills/index.json',
      upstream_digest: 'sha256:abc',
      ref: null,
      upstream_tree: null,
    }), CLI_VERSION));
    expect(frontmatterToSource(mirrored)).toEqual({
      type: 'wellknown',
      url: 'https://example.com/.well-known/agent-skills/index.json',
      upstream_digest: 'sha256:abc',
    });
  });

  it('content-sha names url evidence: download URL + content hash', () => {
    const mirrored = injectFrontmatterMirror('---\nname: s\n---\n# Body\n', mirrorFieldsForSource(aSource({
      type: 'url',
      url: 'https://example.com/SKILL.md',
      upstream_content_sha: 'sha256:def',
      ref: null,
      upstream_tree: null,
    }), CLI_VERSION));
    expect(frontmatterToSource(mirrored)).toEqual({
      type: 'url',
      url: 'https://example.com/SKILL.md',
      upstream_content_sha: 'sha256:def',
    });
  });

  it('a source-url without any anchor names no kind honestly — no evidence, no guess', () => {
    const anchorless = `---\nname: s\nmetadata:\n    skills-manager-source-url: https://example.com/somewhere\n    skills-manager-written-by: skills-manager-cli\n---\n# Body\n`;
    expect(frontmatterToSource(anchorless)).toBeNull();
  });
});

describe('frontmatterToSource: no evidence', () => {
  it('returns null for frontmatter-less content, plain metadata, identity keys only', () => {
    expect(frontmatterToSource('# Body only\n')).toBeNull();
    expect(frontmatterToSource('---\nname: my-skill\nmetadata:\n    local-path: /home/monalisa/skills/my-skill\n---\n# Body\n')).toBeNull();
    expect(frontmatterToSource(`---\nname: s\nmetadata:\n    skills-manager-written-by: skills-manager-cli\n    skills-manager-version: 1.0.0\n---\n# Body\n`)).toBeNull();
  });

  it('returns null on structurally broken YAML — broken evidence is no evidence', () => {
    expect(frontmatterToSource('---\nname: [unclosed\nmetadata:\n---\n# Body\n')).toBeNull();
  });
});

describe('gh contract fixture, both directions (ticket 01 hands the reverse half over here)', () => {
  const loadFixture = () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(here, '..', 'fixtures', 'gh-skill-metadata-fixture.md'), 'utf8');
  };

  it('reads the fixture projected by ticket 01 back into equivalent registry evidence', () => {
    const projected = injectFrontmatterMirror(loadFixture(), mirrorFieldsForSource(aSource(), CLI_VERSION));
    expect(frontmatterToSource(projected)).toEqual({
      type: 'github',
      url: 'https://github.com/monalisa/octocat-skills',
      subpath: 'skills/my-skill',
      ref: 'refs/tags/v1.0.0',
      upstream_tree: 'tree456',
    });
  });

  it('re-reads our own github.com git-kind install as type github — the ADR-0017 host ruling, a pinned asymmetry', () => {
    // Installs persist kind `git` even for github.com URLs; the reader maps by
    // HOST, so the round trip lands on `github`. That is the ruled mapping
    // (github.com→github), not drift — pinned here so nobody "fixes" it silently.
    const source = aSource(); // type 'git', url github.com
    const projected = injectFrontmatterMirror('---\nname: s\n---\n# Body\n', mirrorFieldsForSource(source, CLI_VERSION));
    expect(frontmatterToSource(projected)).toEqual({
      type: 'github',
      url: 'https://github.com/monalisa/octocat-skills',
      subpath: 'skills/my-skill',
      ref: 'refs/tags/v1.0.0',
      upstream_tree: 'tree456',
    });
  });

  it('round-trips our own non-github git install exactly: same kind, same anchors', () => {
    const source = aSource({ url: 'https://gitlab.com/monalisa/octocat-skills.git' });
    const projected = injectFrontmatterMirror('---\nname: s\n---\n# Body\n', mirrorFieldsForSource(source, CLI_VERSION));
    expect(frontmatterToSource(projected)).toEqual({
      type: 'git',
      url: 'https://gitlab.com/monalisa/octocat-skills.git',
      subpath: 'skills/my-skill',
      ref: 'refs/tags/v1.0.0',
      upstream_tree: 'tree456',
    });
  });
});
