/**
 * Trigger rank: given a sample user request, score every hub skill the same way
 * agents do — by term overlap between the request and each skill's
 * `name + description`. Offline and deterministic (no model, no network):
 * IDF-weighted Jaccard over `descriptionTerms`, so words shared by every skill
 * barely count and distinctive request words dominate. Used by
 * `skills-manager trigger test` as a CI assertion and a local debug aid.
 */

import { descriptionTerms } from './description-overlap.js';

export type TriggerSkill = { name: string; description: string };

export type TriggerHit = {
  skill: string;
  /** 0..1, IDF-weighted Jaccard of request terms vs skill name+description. */
  score: number;
  /** Shared terms, most distinctive first (at most 8). */
  shared: string[];
  rank: number;
};

export type TriggerRankReport = {
  method: 'idf-jaccard';
  request: string;
  scanned: number;
  hits: TriggerHit[];
};

export function rankTriggers(request: string, skills: TriggerSkill[]): TriggerRankReport {
  const trimmed = request.trim();
  if (!trimmed) throw new Error('request must be a non-empty string');
  const query = descriptionTerms(trimmed);
  const docs = skills.map((s) => ({
    name: s.name,
    terms: descriptionTerms(`${s.name.replace(/[-_]/g, ' ')} ${s.description ?? ''}`),
  }));
  const df = new Map<string, number>();
  // Document frequency over skills only (the request is the query, not a doc).
  for (const d of docs) for (const t of d.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const n = docs.length;
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;

  const scored: Omit<TriggerHit, 'rank'>[] = [];
  for (const d of docs) {
    if (query.size === 0 || d.terms.size === 0) {
      scored.push({ skill: d.name, score: 0, shared: [] });
      continue;
    }
    let inter = 0;
    let union = 0;
    const shared: string[] = [];
    for (const t of new Set([...query, ...d.terms])) {
      const w = idf(t);
      union += w;
      if (query.has(t) && d.terms.has(t)) {
        inter += w;
        shared.push(t);
      }
    }
    const score = union === 0 ? 0 : inter / union;
    shared.sort((x, y) => idf(y) - idf(x) || x.localeCompare(y));
    scored.push({
      skill: d.name,
      score: Math.round(score * 1000) / 1000,
      shared: shared.slice(0, 8),
    });
  }
  scored.sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill));
  const hits: TriggerHit[] = scored.map((h, i) => ({ ...h, rank: i + 1 }));
  return { method: 'idf-jaccard', request: trimmed, scanned: n, hits };
}

/** Keep the top `limit` hits (all of them when limit is undefined). */
export function takeTop(report: TriggerRankReport, limit?: number): TriggerRankReport {
  if (limit === undefined) return report;
  if (!(Number.isInteger(limit) && limit >= 1)) throw new Error(`--top expects an integer ≥ 1, got ${limit}`);
  return { ...report, hits: report.hits.slice(0, limit) };
}

/**
 * Whether `expect` satisfies the assertion:
 * - with no `top`: must be rank 1
 * - with `top`: must appear somewhere in the top `top` hits
 */
export function expectSatisfied(report: TriggerRankReport, expect: string, top?: number): {
  ok: boolean;
  hit: TriggerHit | undefined;
  detail: string;
} {
  const hit = report.hits.find((h) => h.skill === expect);
  if (!hit) {
    return { ok: false, hit: undefined, detail: `expected skill not in hub: ${expect}` };
  }
  if (top === undefined) {
    const ok = hit.rank === 1;
    return {
      ok,
      hit,
      detail: ok
        ? `${expect} ranked #1 (score ${hit.score.toFixed(3)})`
        : `${expect} ranked #${hit.rank} (score ${hit.score.toFixed(3)}); wanted #1`,
    };
  }
  const ok = hit.rank <= top;
  return {
    ok,
    hit,
    detail: ok
      ? `${expect} ranked #${hit.rank} within top ${top} (score ${hit.score.toFixed(3)})`
      : `${expect} ranked #${hit.rank} (score ${hit.score.toFixed(3)}); wanted within top ${top}`,
  };
}

export function renderTriggerRank(report: TriggerRankReport, opts: { expect?: string; top?: number } = {}): string {
  const shown = takeTop(report, opts.top);
  const lines = [
    `Trigger test (idf-jaccard) — request: ${JSON.stringify(report.request)}`,
    `  scanned ${report.scanned} skill(s); showing ${shown.hits.length}${opts.top ? ` (top ${opts.top})` : ''}`,
  ];
  if (shown.hits.length === 0) {
    lines.push('', '  none — hub is empty');
  } else {
    for (const h of shown.hits) {
      const shared = h.shared.length > 0 ? h.shared.join(', ') : '—';
      lines.push('', `  #${h.rank}  ${h.score.toFixed(3)}  ${h.skill}`, `        shared: ${shared}`);
    }
  }
  if (opts.expect) {
    const verdict = expectSatisfied(report, opts.expect, opts.top);
    lines.push('', `  expect ${opts.expect}: ${verdict.ok ? 'PASS' : 'FAIL'} — ${verdict.detail}`);
  }
  return `${lines.join('\n')}\n`;
}
