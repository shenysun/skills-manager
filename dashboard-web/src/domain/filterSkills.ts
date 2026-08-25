/**
 * Library search filter: whitespace-separated terms, each matching (case-
 * insensitively) somewhere in name, category, or description.
 */
export function filterSkills<T extends { name: string; category: string; description: string }>(
  skills: readonly T[],
  query: string,
): T[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...skills];
  return skills.filter((skill) => {
    const haystack = `${skill.name}\n${skill.category}\n${skill.description}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
