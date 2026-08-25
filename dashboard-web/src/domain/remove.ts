/** The remove confirm speaks in operator terms: how many skills, how many observed agent entries go away. */
export function removeConsequence(skills: readonly { distributedAgents: readonly string[] }[]) {
  return {
    skillCount: skills.length,
    agentCount: skills.reduce((sum, skill) => sum + skill.distributedAgents.length, 0),
  };
}
