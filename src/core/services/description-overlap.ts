/**
 * Description overlap: agents route by comparing the user's message against every
 * skill's `name + description`. Two skills whose descriptions claim the same
 * trigger words compete, and the agent may pick the wrong one or neither.
 * This finds those pairs offline and deterministically (no model, no network):
 * IDF-weighted Jaccard over description terms, so words shared by every skill
 * ("use", "skill", "when") barely count and distinctive shared words dominate.
 */

export type OverlapInput = { name: string; description: string };

export type OverlapPair = {
  a: string;
  b: string;
  /** 0..1, IDF-weighted Jaccard of the two term sets. */
  score: number;
  /** Shared terms, most distinctive first (at most 8). */
  shared: string[];
  /** A boundary sentence to add to each description (report-only). */
  suggestion: string;
};

export type OverlapReport = {
  method: 'idf-jaccard';
  threshold: number;
  scanned: number;
  pairs: OverlapPair[];
};

const STOPWORDS = new Set(
  ('the and for with when use used using this that these those from into your you are any all can will not but its '
    + 'via etc also such more most other than then them they their what which who how why where about over under '
    + 'skill skills agent agents user users task tasks asks ask wants want need needs help helps make makes run runs '
    + 'should must may might before after each every one two new get gets set sets out only just like well').split(' '),
);

/** Lowercase ASCII words (len ≥ 3, light plural strip) plus CJK bigrams. */
export function descriptionTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const lower = text.toLowerCase();
  for (const raw of lower.match(/[a-z][a-z0-9]+/g) ?? []) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    const word = raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw;
    if (!STOPWORDS.has(word)) terms.add(word);
  }
  for (const run of lower.match(/[\u3400-\u9fff]+/g) ?? []) {
    if (run.length === 1) terms.add(run);
    for (let i = 0; i + 1 < run.length; i += 1) terms.add(run.slice(i, i + 2));
  }
  return terms;
}

export function findDescriptionOverlaps(skills: OverlapInput[], threshold = 0.3): OverlapReport {
  if (!(threshold >= 0 && threshold <= 1)) throw new Error(`threshold must be within 0..1, got ${threshold}`);
  const docs = skills.map((s) => ({ name: s.name, terms: descriptionTerms(`${s.name.replace(/[-_]/g, ' ')} ${s.description ?? ''}`) }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  const pairs: OverlapPair[] = [];
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const A = docs[i];
      const B = docs[j];
      if (A.terms.size === 0 || B.terms.size === 0) continue;
      let inter = 0;
      let union = 0;
      const shared: string[] = [];
      for (const t of new Set([...A.terms, ...B.terms])) {
        const w = idf(t);
        union += w;
        if (A.terms.has(t) && B.terms.has(t)) { inter += w; shared.push(t); }
      }
      const score = union === 0 ? 0 : inter / union;
      if (shared.length === 0 || score < threshold) continue;
      const [a, b] = [A.name, B.name].sort();
      shared.sort((x, y) => idf(y) - idf(x) || x.localeCompare(y));
      const top = shared.slice(0, 8);
      pairs.push({
        a,
        b,
        score: Math.round(score * 1000) / 1000,
        shared: top,
        suggestion: `Draw a boundary in each description, e.g. in ${a}: "… For <the other case>, use the ${b} skill instead." (and vice versa), or merge them if they really do the same job.`,
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  return { method: 'idf-jaccard', threshold, scanned: n, pairs };
}

export function renderOverlapReport(report: OverlapReport): string {
  const lines = [`Description overlap (idf-jaccard ≥ ${report.threshold}) — ${report.pairs.length} pair(s) across ${report.scanned} skill(s)`];
  if (report.pairs.length === 0) lines.push('', '  none — every description has its own trigger words');
  for (const p of report.pairs) {
    lines.push('', `  ${p.score.toFixed(2)}  ${p.a} ↔ ${p.b}`, `        shared: ${p.shared.join(', ')}`, `        fix:    ${p.suggestion}`);
  }
  return `${lines.join('\n')}\n`;
}
