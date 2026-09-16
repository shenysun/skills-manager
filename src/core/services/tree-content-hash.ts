import { createHash } from 'node:crypto';
import path from 'node:path';
import type { FileSystemPort } from '../ports/filesystem.js';

/**
 * The one upstream tree content hash (ADR-0016/0017): the value install
 * persists as the url source's `upstream_content_sha` and detection computes
 * over the re-downloaded tree — the pair that must never drift, hence one
 * shared implementation. Byte-identical by construction to
 * DistributeService.fingerprintDir (same walk order, same hashed fields);
 * that one stays separate because it fingerprints hub/runtime trees whose
 * SKILL.md legitimately carry the frontmatter mirror, while this value
 * anchors what the *upstream* served.
 */
export function treeContentSha(fs: FileSystemPort, root: string): string | null {
  if (fs.kind(root) !== 'directory') return null;
  const hash = createHash('sha256');
  const walk = (prefix: string) => {
    const dir = prefix ? path.join(root, prefix) : root;
    for (const entry of fs.readDirectory(dir).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      const full = path.join(root, relative);
      const kind = fs.kind(full);
      hash.update(relative);
      hash.update('\0');
      hash.update(kind);
      hash.update('\0');
      if (kind === 'file') hash.update(fs.readText(full));
      else if (kind === 'symlink') hash.update(fs.readlink(full));
      if (entry.kind === 'directory') walk(relative);
    }
  };
  walk('');
  return `sha256:${hash.digest('hex')}`;
}
