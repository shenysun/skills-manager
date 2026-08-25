/**
 * The dashboard has exactly one page, so the hash layer is a redirect shim:
 * any bookmarked hash (five legacy surfaces, older discover/updates/settings
 * hashes, or anything else) lands on the canonical no-hash location.
 */
export type ResolvedHash = { hash: '' ; redirect: boolean };

export function resolveHash(rawHash: string): ResolvedHash {
  const stripped = rawHash.trim().replace(/^#\/?/, '');
  return { hash: '', redirect: stripped !== '' };
}
