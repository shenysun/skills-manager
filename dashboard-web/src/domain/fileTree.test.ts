import { describe, expect, it } from 'vitest';
import { buildFileTree, defaultPreviewPath, type FileTreeNode } from './fileTree';

describe('buildFileTree (flat paths → hierarchy)', () => {
  it('nests deep paths correctly', () => {
    const tree = buildFileTree(['agents/vendor/lib/deep.mjs']);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('agents');
    expect(tree[0].children?.[0]?.name).toBe('vendor');
    expect(tree[0].children?.[0]?.children?.[0]?.name).toBe('lib');
    expect(tree[0].children?.[0]?.children?.[0]?.children?.[0]).toMatchObject({ name: 'deep.mjs', path: 'agents/vendor/lib/deep.mjs' });
  });

  it('orders directories before files, each dictionary-sorted', () => {
    const tree = buildFileTree(['run.sh', 'SKILL.md', 'docs/a.md', 'agents/x.js', 'docs/b.md']);
    expect(names(tree)).toEqual(['agents', 'docs', 'SKILL.md', 'run.sh']);
    expect(names(tree[1].children ?? [])).toEqual(['a.md', 'b.md']);
  });

  it('returns an empty tree for no files', () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it('keeps every node path fully qualified from the skill root', () => {
    const tree = buildFileTree(['a/b/c.txt']);
    expect(tree[0].path).toBe('a');
    expect(tree[0].children?.[0]?.path).toBe('a/b');
    expect(tree[0].children?.[0]?.children?.[0]?.path).toBe('a/b/c.txt');
  });
});

describe('defaultPreviewPath', () => {
  it('picks SKILL.md when present', () => {
    expect(defaultPreviewPath(['docs/a.md', 'SKILL.md'])).toBe('SKILL.md');
  });

  it('falls back to the first file when SKILL.md is absent', () => {
    expect(defaultPreviewPath(['docs/a.md', 'run.sh'])).toBe('docs/a.md');
  });

  it('returns null for an empty skill', () => {
    expect(defaultPreviewPath([])).toBeNull();
  });
});

function names(nodes: FileTreeNode[]): string[] {
  return nodes.map((node) => node.name);
}
