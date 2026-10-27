/**
 * Description fix: deterministic, offline rewrites for what `audit descriptions`
 * and `audit overlap` report. Proposals only. The CLI prints them as a diff
 * and writes nothing unless `--write` is passed. Rules that need a human
 * (missing, vague, name-format) are never "fixed"; they are listed as manual.
 */
import YAML from 'yaml';
import { DESCRIPTION_MAX_CHARS, lintDescription, type LintRule } from './description-lint.js';
import { descriptionTerms, findDescriptionOverlaps, type OverlapInput } from './description-overlap.js';

export type DescriptionProposal = {
  skill: string;
  before: string;
  after: string;
  /** Rules the rewrite addresses, plus 'overlap' for boundary lines. */
  applied: Array<LintRule | 'overlap'>;
  /** Findings that need a human (no safe template). */
  manual: LintRule[];
};

const MANUAL: LintRule[] = ['missing', 'vague', 'name-format'];
/** Generic verbs that make poor trigger words even when they are rare in a hub. */
const WEAK = new Set('create creates build builds write writes find finds give gives show shows work works also go goes take takes keep keeps add adds plain current fresh last long'.split(' '));

/** Rank terms rarest-first across the hub (ties keep text order), so the cue words are the distinctive ones. */
type Rarity = (term: string) => number;
function hubRarity(texts: string[]): Rarity {
  const df = new Map<string, number>();
  for (const text of texts) for (const term of descriptionTerms(text)) df.set(term, (df.get(term) ?? 0) + 1);
  return (term) => -(df.get(term) ?? 0);
}
function pick(terms: string[], rarity: Rarity, n: number): string[] {
  return terms.filter((t) => /^[a-z]/.test(t) && !WEAK.has(t))
    .map((t, i) => ({ t, i })).sort((a, b) => rarity(b.t) - rarity(a.t) || a.i - b.i).slice(0, n).map((x) => x.t);
}

function sentence(text: string): string {
  const t = text.trim();
  return t && !/[.!?。！？]$/.test(t) ? `${t}.` : t;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Rewrite one description for the lint rules that have a safe template. */
export function fixDescription(name: string, description: string, rarity: Rarity = () => 0): DescriptionProposal {
  const lint = lintDescription(name, description);
  const rules = new Set(lint.findings.map((f) => f.rule));
  const applied: DescriptionProposal['applied'] = [];
  let text = description.trim();
  if (rules.has('missing')) return { skill: name, before: description, after: description, applied, manual: ['missing', ...lint.findings.map((f) => f.rule).filter((r) => r !== 'missing' && MANUAL.includes(r))] };

  if (rules.has('xml-tag')) {
    text = text.replace(/<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/g, '').replace(/\s{2,}/g, ' ').trim();
    applied.push('xml-tag');
  }
  if (rules.has('point-of-view')) {
    text = text
      .replace(/(^|[.!?]\s+)(?:I can help you|I can help|I help you|I can|I will|I'll|You can use this(?: skill)? to|You can use (?:it|me) to|You can|We can|Let me)\s+(\w)/g, (_m, lead: string, c: string) => `${lead}${c.toUpperCase()}`)
      .replace(/\byou can use\b/gi, 'use');
    applied.push('point-of-view');
  }
  if (rules.has('no-trigger')) {
    const nameWords = new Set(name.split(/[-_]+/));
    const topic = pick([...descriptionTerms(text)].filter((t) => !nameWords.has(t)), rarity, 3);
    const subject = name.replace(/[-_]+/g, ' ');
    text = topic.length > 0
      ? `${sentence(text)} Use when the user mentions ${topic.join(', ')}, or asks for ${subject}.`
      : `${sentence(text)} Use when the user asks for ${subject}.`;
    applied.push('no-trigger');
  }
  if (text.length > DESCRIPTION_MAX_CHARS) {
    const trigger = text.match(/\s(Use when[^.]*\.)\s*$/)?.[1] ?? '';
    const room = DESCRIPTION_MAX_CHARS - (trigger ? trigger.length + 1 : 0);
    const head = text.slice(0, text.length - (trigger ? trigger.length : 0)).slice(0, room);
    const cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('。'));
    text = `${(cut > 0 ? head.slice(0, cut + 1) : head.slice(0, room - 1)).trim()}${trigger ? ` ${trigger}` : ''}`.slice(0, DESCRIPTION_MAX_CHARS);
    applied.push('too-long');
  }
  const manual = lint.findings.map((f) => f.rule).filter((r) => MANUAL.includes(r));
  return { skill: name, before: description, after: text, applied, manual };
}

export function fixDescriptions(skills: Array<{ name: string; description?: string | null }>): DescriptionProposal[] {
  const rarity = hubRarity(skills.map((s) => s.description ?? ''));
  return skills
    .map((s) => fixDescription(s.name, s.description ?? '', rarity))
    .filter((p) => p.applied.length > 0 || p.manual.length > 0)
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

/** Terms of `b` that `a` lacks, rarest first: the words that make `b` different. */
function distinctTerms(a: string, b: string, rarity: Rarity): string[] {
  const mine = descriptionTerms(a);
  return pick([...descriptionTerms(b)].filter((t) => !mine.has(t)), rarity, 3);
}

/** Boundary lines for every overlapping pair: each side gets "For <the other's distinct terms>, use the <other> skill instead." */
export function boundaryProposals(skills: OverlapInput[], threshold = 0.3): DescriptionProposal[] {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const rarity = hubRarity(skills.map((s) => s.description ?? ''));
  const after = new Map<string, string>();
  for (const pair of findDescriptionOverlaps(skills, threshold).pairs) {
    for (const [self, other] of [[pair.a, pair.b], [pair.b, pair.a]] as const) {
      const me = byName.get(self)!;
      const them = byName.get(other)!;
      const current = after.get(self) ?? me.description.trim();
      if (current.includes(`use the ${other} skill instead`)) continue;
      const theirs = distinctTerms(me.description, them.description, rarity);
      const mine = distinctTerms(them.description, me.description, rarity);
      const what = theirs.length > 0 ? theirs.join(', ') : mine.length > 0 ? `the same job without ${mine.join(', ')}` : other.replace(/[-_]+/g, ' ');
      after.set(self, `${sentence(current)} For ${what}, use the ${other} skill instead.`);
    }
  }
  return [...after.entries()]
    .map(([skill, text]) => ({ skill, before: byName.get(skill)!.description, after: text, applied: ['overlap' as const], manual: [] }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

/** Human-readable diff of the proposals. */
export function renderProposals(title: string, proposals: DescriptionProposal[], written: boolean): string {
  const changed = proposals.filter((p) => p.after !== p.before);
  const lines = [`${title} — ${changed.length} rewrite(s)${written ? ' written' : ' proposed (dry run; add --write to apply)'}`];
  for (const p of proposals) {
    lines.push('', `--- ${p.skill} (description)`);
    if (p.after !== p.before) lines.push(`- ${p.before.trim()}`, `+ ${p.after}`, `  fixes: ${p.applied.join(', ')}`);
    if (p.manual.length > 0) lines.push(`  needs you: ${p.manual.join(', ')} (no safe template; edit by hand)`);
  }
  if (proposals.length === 0) lines.push('', '  nothing to rewrite');
  return `${lines.join('\n')}\n`;
}

/** Replace only the `description` key in a SKILL.md's frontmatter; every other byte stays as it was. */
export function replaceFrontmatterDescription(text: string, description: string): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error('SKILL.md has no frontmatter to write the description into');
  const lines = match[1].split(/\r?\n/);
  const start = lines.findIndex((l) => /^description\s*:/.test(l));
  const rendered = YAML.stringify({ description }, { lineWidth: 0 }).trimEnd();
  if (start === -1) {
    lines.push(rendered);
  } else {
    let end = start + 1;
    while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === '')) end += 1;
    while (end > start + 1 && lines[end - 1].trim() === '') end -= 1;
    lines.splice(start, end - start, rendered);
  }
  return `---\n${lines.join('\n')}\n---${text.slice(match[0].length)}`;
}
