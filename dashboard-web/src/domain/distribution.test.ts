import { describe, expect, it } from 'vitest';
import { distCountsText, projectRootsOf, type DistributionTarget } from './distribution';

const user: DistributionTarget = { kind: 'user', targetRoot: '/Users/x', entries: [] };
const projA: DistributionTarget = { kind: 'project', targetRoot: '/Users/x/proj-a', entries: [] };
const projB: DistributionTarget = { kind: 'project', targetRoot: '/Users/x/proj-b', entries: [] };

describe('projectRootsOf (接入 reverse lookup counts)', () => {
  it('returns the project target roots in index order', () => {
    expect(projectRootsOf([user, projA, projB])).toEqual(['/Users/x/proj-a', '/Users/x/proj-b']);
  });

  it('is empty for user-only or no distribution', () => {
    expect(projectRootsOf([user])).toEqual([]);
    expect(projectRootsOf([])).toEqual([]);
  });
});

describe('distCountsText (shared N agents · M projects label)', () => {
  const t = (key: string, n: number) => (key === 'status.agents' ? `${n} agents` : `${n} projects`);

  it('appends the projects segment only when there is one', () => {
    expect(distCountsText(t, 7, 2)).toBe('7 agents · 2 projects');
    expect(distCountsText(t, 3, 0)).toBe('3 agents');
  });
});
