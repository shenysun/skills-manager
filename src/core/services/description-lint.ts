/**
 * Description lint: the description is the only thing an agent sees before it
 * decides to load a skill. This checks each one against the published Agent
 * Skills rules (non-empty, ≤ 1024 chars, no XML tags; name ≤ 64 chars of
 * lowercase letters/digits/hyphens, no reserved words) and the authoring
 * guidance (say *when* to use it, third person, concrete terms). Offline,
 * deterministic, report-only.
 */

export type LintSeverity = 'error' | 'warn';
export type LintRule = 'missing' | 'too-long' | 'xml-tag' | 'name-format' | 'no-trigger' | 'point-of-view' | 'vague';
export type LintFinding = { rule: LintRule; severity: LintSeverity; message: string; fix: string };
export type DescriptionLint = { skill: string; chars: number; score: number; findings: LintFinding[] };
export type DescriptionLintReport = { scanned: number; errors: number; warnings: number; skills: DescriptionLint[] };

export const DESCRIPTION_MAX_CHARS = 1024;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TRIGGER_RE = /\b(use (it |this )?(when|for|to|if|whenever|before|after)|when (the )?(user|you|asked|working|someone)|whenever|triggers? (on|when)|invoke when|applies when)\b|当|时使用|时调用|用于|适用于|使用场景|只要|使用本|就(必须|应)?使用|触发/i;
const POV_RE = /(^|[.!?]\s+)(I|I'm|I'll|We|You)\b|\bI (can|will|help|am)\b|\byou can use\b|\blet me\b|我(可以|能|会)帮/;
const FILLER = new Set('the and for with this that from into your you are any all can will not use used using helps help does stuff things various general misc etc skill skills tool tools data files file work works handles handle'.split(' '));

function distinctiveTerms(text: string): number {
  const ascii = (text.toLowerCase().match(/[a-z][a-z0-9.+#-]{2,}/g) ?? []).filter((w) => !FILLER.has(w));
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  return new Set(ascii).size + Math.floor(cjk / 2);
}

export function lintDescription(name: string, description: string | undefined | null): DescriptionLint {
  const text = (description ?? '').trim();
  const findings: LintFinding[] = [];
  const add = (rule: LintRule, severity: LintSeverity, message: string, fix: string) => findings.push({ rule, severity, message, fix });

  if (name.length > 64 || !NAME_RE.test(name) || /anthropic|claude/.test(name)) {
    add('name-format', 'error', `name "${name}" breaks the Agent Skills name rules`, 'use ≤ 64 lowercase letters, digits and hyphens, without "anthropic" or "claude"');
  }
  if (!text) {
    add('missing', 'error', 'no description: the agent has nothing to match against, so it can only be invoked by name', 'add a description: what it does, then "Use when …" with the words users actually say');
    return finish(name, text, findings);
  }
  if (text.length > DESCRIPTION_MAX_CHARS) {
    add('too-long', 'error', `${text.length} chars, over the ${DESCRIPTION_MAX_CHARS}-char limit (rejected or cut, and paid on every message)`, 'keep the trigger phrases and move the detail into the SKILL.md body');
  }
  if (/<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/.test(text)) {
    add('xml-tag', 'error', 'contains an XML/HTML tag, which the Agent Skills spec forbids', 'remove the tag or write it in plain words');
  }
  if (!TRIGGER_RE.test(text)) {
    add('no-trigger', 'warn', 'says what it does but never says when to use it', 'append a trigger clause, e.g. "Use when the user asks to …, or mentions …"');
  }
  if (POV_RE.test(text)) {
    add('point-of-view', 'warn', 'written in first or second person; descriptions are injected into the system prompt and should be third person', 'rephrase as "Generates …" / "Use when …" instead of "I can …" / "You can …"');
  }
  if (text.length < 40 || distinctiveTerms(text) < 4) {
    add('vague', 'warn', 'too short or generic to match real requests (e.g. "Helps with documents")', 'name the concrete objects, tools, file types and verbs it covers');
  }
  return finish(name, text, findings);
}

function finish(skill: string, text: string, findings: LintFinding[]): DescriptionLint {
  const penalty = findings.reduce((sum, f) => sum + (f.severity === 'error' ? 40 : 15), 0);
  return { skill, chars: text.length, score: Math.max(0, 100 - penalty), findings };
}

export function lintDescriptions(skills: Array<{ name: string; description?: string | null }>): DescriptionLintReport {
  const rows = skills.map((s) => lintDescription(s.name, s.description)).sort((a, b) => a.score - b.score || a.skill.localeCompare(b.skill));
  const all = rows.flatMap((r) => r.findings);
  return { scanned: rows.length, errors: all.filter((f) => f.severity === 'error').length, warnings: all.filter((f) => f.severity === 'warn').length, skills: rows };
}

export function renderDescriptionLint(report: DescriptionLintReport): string {
  const flagged = report.skills.filter((s) => s.findings.length > 0);
  const lines = [`Description lint — ${report.scanned} skill(s): ${report.errors} error(s), ${report.warnings} warning(s), ${report.scanned - flagged.length} clean`];
  if (flagged.length === 0) lines.push('', '  every description says what it does and when to use it');
  for (const s of flagged) {
    lines.push('', `  ${String(s.score).padStart(3)}  ${s.skill}  (${s.chars} chars)`);
    for (const f of s.findings) lines.push(`       ${f.severity === 'error' ? 'ERROR' : 'warn '} ${f.rule}: ${f.message}`, `             fix: ${f.fix}`);
  }
  return `${lines.join('\n')}\n`;
}
