/**
 * The preview Sheet's left-hand file tree: flat relative paths from
 * GET /api/skill/files folded into a hierarchy. Directories come before
 * files, each dictionary-sorted — a stable, predictable navigation order.
 */
export type FileTreeNode = {
  name: string;
  /** Path relative to the skill root (slash-separated); directories included. */
  path: string;
  /** Present on directory nodes only. */
  children?: FileTreeNode[];
};

export function buildFileTree(paths: readonly string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const filePath of paths) {
    const segments = filePath.split('/');
    let level = root;
    let prefix = '';
    segments.forEach((segment, index) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isLeaf = index === segments.length - 1;
      let node = level.find((candidate) => candidate.name === segment);
      if (!node) {
        node = isLeaf ? { name: segment, path: prefix } : { name: segment, path: prefix, children: [] };
        level.push(node);
      }
      if (!isLeaf) level = node.children ??= [];
    });
  }
  const sortLevel = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      const aDir = a.children !== undefined;
      const bDir = b.children !== undefined;
      if (aDir !== bDir) return aDir ? -1 : 1; // directories first
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; // code-point order, same as the server's file list
    });
    for (const node of nodes) if (node.children) sortLevel(node.children);
  };
  sortLevel(root);
  return root;
}

/** The file the preview opens on: SKILL.md when present, else the first file. */
export function defaultPreviewPath(paths: readonly string[]): string | null {
  if (paths.includes('SKILL.md')) return 'SKILL.md';
  return paths[0] ?? null;
}
