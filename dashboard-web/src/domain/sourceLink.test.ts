import { describe, expect, it } from 'vitest';
import { sourceLink, type SkillSourceInfo } from './sourceLink';

const source = (overrides: Partial<SkillSourceInfo> = {}): SkillSourceInfo => ({
  type: 'git',
  url: 'https://github.com/owner/repo.git',
  subpath: null,
  ref: null,
  ...overrides,
});

describe('sourceLink (来源 segment rendering)', () => {
  it('omits the segment entirely when there is no recorded source', () => {
    expect(sourceLink(null)).toBeNull();
    expect(sourceLink({ type: 'git', url: '', subpath: null, ref: null })).toBeNull();
  });

  it('renders a local source as plain text — no href', () => {
    expect(sourceLink(source({ type: 'local', url: '/abs/path/to/source' }))).toEqual({
      href: null,
      label: '/abs/path/to/source',
    });
  });

  it('links a github https clone url to the repo root as owner/repo', () => {
    expect(sourceLink(source())).toEqual({ href: 'https://github.com/owner/repo', label: 'owner/repo' });
  });

  it('deep-links a github source with subpath to the tree url, ref first', () => {
    expect(sourceLink(source({ subpath: 'skills/alpha', ref: 'main' }))).toEqual({
      href: 'https://github.com/owner/repo/tree/main/skills/alpha',
      label: 'owner/repo',
    });
  });

  it('falls back to HEAD as the tree ref when none is recorded', () => {
    expect(sourceLink(source({ subpath: 'skills/alpha' }))).toEqual({
      href: 'https://github.com/owner/repo/tree/HEAD/skills/alpha',
      label: 'owner/repo',
    });
  });

  it('understands github ssh urls and non-.git https urls', () => {
    expect(sourceLink(source({ url: 'git@github.com:owner/repo.git' }))).toEqual({
      href: 'https://github.com/owner/repo',
      label: 'owner/repo',
    });
    expect(sourceLink(source({ url: 'https://github.com/owner/repo' }))).toEqual({
      href: 'https://github.com/owner/repo',
      label: 'owner/repo',
    });
  });

  it('links non-github git hosts to the repo root only — tree urls are host-specific', () => {
    expect(sourceLink(source({ url: 'https://gitlab.com/owner/repo.git' }))).toEqual({
      href: 'https://gitlab.com/owner/repo',
      label: 'gitlab.com/owner/repo',
    });
    expect(sourceLink(source({ url: 'git@gitlab.com:owner/repo.git' }))).toEqual({
      href: 'https://gitlab.com/owner/repo',
      label: 'gitlab.com/owner/repo',
    });
  });

  it('never links a non-http(s) url — plain text, whatever the scheme', () => {
    expect(sourceLink(source({ url: 'javascript:alert(1)' }))).toEqual({ href: null, label: 'javascript:alert(1)' });
    expect(sourceLink(source({ url: 'ftp://example.com/repo' }))).toEqual({ href: null, label: 'ftp://example.com/repo' });
  });
});
