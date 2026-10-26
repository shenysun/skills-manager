/**
 * Trigger fixtures: a YAML or JSON file of `{ request, expect, top? }` cases so
 * CI can assert many phrasings with one command (`trigger test --fixtures`).
 * Offline and deterministic — same ranking as a single `trigger test` call.
 */

import path from 'node:path';
import YAML from 'yaml';
import { expectSatisfied, rankTriggers, type TriggerRankReport, type TriggerSkill } from './trigger-rank.js';

export type TriggerFixtureCase = {
  /** Sample user request / message. */
  request: string;
  /** Canonical skill that must rank first (or within `top`). */
  expect: string;
  /** Optional top-N window (same meaning as `--top`). */
  top?: number;
};

export type TriggerFixtureFile = {
  /** Optional label for humans / CI logs. */
  name?: string;
  fixtures: TriggerFixtureCase[];
};

export type TriggerFixtureResult = {
  index: number;
  request: string;
  expect: string;
  top?: number;
  ok: boolean;
  detail: string;
  rank: number | null;
  score: number | null;
  report: TriggerRankReport;
};

export type TriggerFixturesReport = {
  method: 'idf-jaccard';
  file: string;
  name?: string;
  scanned: number;
  total: number;
  passed: number;
  failed: number;
  results: TriggerFixtureResult[];
};

function asPositiveInt(value: unknown, label: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${label} expects an integer ≥ 1, got ${JSON.stringify(value)}`);
  return n;
}

function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

/** Parse a fixtures document (object with `fixtures[]`, or a bare array). */
export function parseTriggerFixtures(raw: unknown, sourceLabel = 'fixtures'): TriggerFixtureFile {
  let name: string | undefined;
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.name === 'string' && obj.name.trim()) name = obj.name.trim();
    if (!Array.isArray(obj.fixtures)) {
      throw new Error(`${sourceLabel}: expected { fixtures: [...] } or a top-level array`);
    }
    list = obj.fixtures;
  } else {
    throw new Error(`${sourceLabel}: expected a YAML/JSON object or array`);
  }
  if ((list as unknown[]).length === 0) throw new Error(`${sourceLabel}: fixtures list is empty`);
  const fixtures: TriggerFixtureCase[] = (list as unknown[]).map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${sourceLabel}[${i}]: each entry must be an object`);
    }
    const row = item as Record<string, unknown>;
    const request = asNonEmptyString(row.request, `${sourceLabel}[${i}].request`);
    const expect = asNonEmptyString(row.expect, `${sourceLabel}[${i}].expect`);
    const top = row.top === undefined ? undefined : asPositiveInt(row.top, `${sourceLabel}[${i}].top`);
    const unknown = Object.keys(row).filter((k) => !['request', 'expect', 'top'].includes(k));
    if (unknown.length > 0) throw new Error(`${sourceLabel}[${i}]: unknown key(s): ${unknown.join(', ')}`);
    return top === undefined ? { request, expect } : { request, expect, top };
  });
  return name ? { name, fixtures } : { fixtures };
}

/** Load fixtures from a `.yaml` / `.yml` / `.json` file body. */
export function loadTriggerFixturesText(text: string, filePath: string): TriggerFixtureFile {
  const ext = path.extname(filePath).toLowerCase();
  let raw: unknown;
  try {
    if (ext === '.json') raw = JSON.parse(text) as unknown;
    else if (ext === '.yaml' || ext === '.yml' || ext === '') raw = YAML.parse(text) as unknown;
    else throw new Error(`--fixtures expects .yaml, .yml, or .json (got ${ext || 'no extension'})`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('--fixtures expects')) throw err;
    throw new Error(`Failed to parse fixtures file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseTriggerFixtures(raw, path.basename(filePath));
}

export function runTriggerFixtures(
  file: TriggerFixtureFile,
  skills: TriggerSkill[],
  opts: { filePath: string },
): TriggerFixturesReport {
  const skillNames = new Set(skills.map((s) => s.name));
  const results: TriggerFixtureResult[] = [];
  for (let i = 0; i < file.fixtures.length; i += 1) {
    const c = file.fixtures[i];
    if (!skillNames.has(c.expect)) {
      results.push({
        index: i,
        request: c.request,
        expect: c.expect,
        top: c.top,
        ok: false,
        detail: `expected skill not in hub: ${c.expect}`,
        rank: null,
        score: null,
        report: rankTriggers(c.request, skills),
      });
      continue;
    }
    const report = rankTriggers(c.request, skills);
    const verdict = expectSatisfied(report, c.expect, c.top);
    results.push({
      index: i,
      request: c.request,
      expect: c.expect,
      top: c.top,
      ok: verdict.ok,
      detail: verdict.detail,
      rank: verdict.hit?.rank ?? null,
      score: verdict.hit?.score ?? null,
      report,
    });
  }
  const passed = results.filter((r) => r.ok).length;
  return {
    method: 'idf-jaccard',
    file: opts.filePath,
    name: file.name,
    scanned: skills.length,
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };
}

export function renderTriggerFixtures(report: TriggerFixturesReport): string {
  const title = report.name ? `${report.name} · ` : '';
  const lines = [
    `Trigger fixtures (${report.method}) — ${title}${report.file}`,
    `  ${report.passed}/${report.total} passed · scanned ${report.scanned} skill(s)`,
  ];
  for (const r of report.results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    const top = r.top !== undefined ? ` (top ${r.top})` : '';
    lines.push('', `  [${mark}] #${r.index + 1} expect ${r.expect}${top}`, `        request: ${JSON.stringify(r.request)}`, `        ${r.detail}`);
  }
  const verdict = report.failed === 0 ? 'PASS' : 'FAIL';
  lines.push('', `  fixtures: ${verdict} (${report.passed}/${report.total})`);
  return `${lines.join('\n')}\n`;
}
