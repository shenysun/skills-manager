/**
 * Update affordances are invisible when there is nothing to do (story 14/15):
 * the top strip appears iff at least one skill is updatable, and the row
 * button renders only on rows flagged hasUpdate.
 */
export function showUpdateStrip(updateCount: number): boolean {
  return updateCount > 0;
}

export function updatableNames(skills: readonly { name: string; hasUpdate: boolean }[]): string[] {
  return skills.filter((skill) => skill.hasUpdate).map((skill) => skill.name);
}
