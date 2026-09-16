/**
 * Edit-distance name suggestions for the reference layer (spec
 * provenance-get US21): when an operator or agent mistypes a skill name, the
 * miss should point back at the hub instead of sending them to the registry.
 */

/** Levenshtein edit distance, case-insensitive — suggestion quality, not exactness. */
export function editDistance(a: string, b: string): number {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  // Single-row DP: row[j] = distance(left, right.slice(0, j)).
  let row = Array.from({ length: right.length + 1 }, (_, j) => j);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) {
      const substitution = row[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1);
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, substitution);
    }
    row = next;
  }
  return row[right.length];
}

/** Closest candidate names within two edits, nearest first, capped at three. */
export function closestMatches(input: string, candidates: readonly string[]): string[] {
  return candidates
    .map((candidate) => ({ candidate, distance: editDistance(input, candidate) }))
    .filter((entry) => entry.distance <= 2)
    .sort((x, y) => x.distance - y.distance || x.candidate.localeCompare(y.candidate))
    .slice(0, 3)
    .map((entry) => entry.candidate);
}
