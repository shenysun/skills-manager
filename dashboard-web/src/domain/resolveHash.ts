/**
 * The dashboard has exactly one page, so the hash layer is a redirect shim:
 * any bookmarked hash (five legacy surfaces, older discover/updates/settings
 * hashes, or anything else) lands on the canonical no-hash location.
 */
export type ResolvedHash = { redirect: boolean };

export function resolveHash(rawHash: string): ResolvedHash {
  return { redirect: rawHash.trim().replace(/^#\/?/, '') !== '' };
}
