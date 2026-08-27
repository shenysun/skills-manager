/**
 * 来源 segment (CONTEXT.md · Skill preview): a git source renders as an
 * owner/repo link to its web tree; a local source renders as plain text;
 * a missing source (imported skills, ADR-0006) omits the segment entirely.
 * Label/href derivation is pure so the Sheet only binds.
 */

export type SkillSourceInfo = {
  type: string;
  url: string;
  subpath: string | null;
  ref: string | null;
};

/** href null ⇒ plain text (local paths cannot be jumped to). */
export type SourceLink = { href: string | null; label: string };

const GITHUB_HTTPS = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const GITHUB_SSH = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/;

function github(owner: string, repo: string, source: SkillSourceInfo): SourceLink {
  const label = `${owner}/${repo}`;
  const base = `https://github.com/${owner}/${repo}`;
  if (!source.subpath) return { href: base, label };
  return { href: `${base}/tree/${source.ref || 'HEAD'}/${source.subpath.replace(/\/+$/, '')}`, label };
}

export function sourceLink(source: SkillSourceInfo | null): SourceLink | null {
  const url = source?.url.trim();
  if (!url) return null;
  if (source.type === 'local' || /^[./~]/.test(url)) return { href: null, label: url };

  const https = url.match(GITHUB_HTTPS);
  if (https) return github(https[1], https[2], source);
  const ssh = url.match(GITHUB_SSH);
  if (ssh) return github(ssh[1], ssh[2], source);

  // Other git hosts: link the repo root only — tree URLs are host-specific
  // (/tree/ vs /-/tree/ vs /src/), so deep-linking would be a guess. Only
  // http(s) survives as an href; anything else degrades to plain text.
  const web = url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '');
  if (!/^https?:\/\//.test(web)) return { href: null, label: url };
  try {
    const { hostname, pathname } = new URL(web);
    return { href: web, label: `${hostname}${pathname}`.replace(/\/$/, '') };
  } catch {
    return { href: null, label: url };
  }
}
