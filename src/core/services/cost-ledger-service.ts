import path from 'node:path';
import type { DistributionTargetKind, RegistryEntry, SkillHome, CostSkillLine, CostPathGroup, CostLedgerError, CostSuggestion, CostScatteredSuggestion, CostSuggestions, CostLedger } from '../model/index.js';
import { isBrokenSymlink, type FileSystemPort } from '../ports/filesystem.js';
import { parseSkillFrontmatter } from './frontmatter-mirror.js';
import type { RegistryService } from './registry-service.js';
import type { DistributeService } from './distribute-service.js';

/**
 * The cost ledger's counting core (ADR-0018, CONTEXT "Cost ledger"): a
 * read-only resident-cost account over the hub distribution index, grouped by
 * physical runtime path (user and project both, a shared path once). The index
 * drives enumeration; the runtime SKILL.md actually present drives counting.
 * This service never writes and never suggests execution — report-only is the
 * ledger's contract.
 */

/** CJK blocks counted at 1 token per character (char-approx, ADR-0018):
 *  radicals + CJK punctuation, kana, hangul compatibility jamo, ext-A, the
 *  unified block, hangul syllables, compatibility ideographs, fullwidth forms. */
const CJK_RANGE = /[⺀-〿぀-ヿ㄰-㆏㐀-䶿一-鿿가-힣豈-﫿＀-￯]/;

/** char-approx token estimate: CJK characters ×1, all other characters ÷4.
 *  A magnitude reference, never an exact count — `method: "char-approx"` says
 *  so in every JSON the ledger emits. */
export function charApproxTokens(text: string): number {
  let cjk = 0;
  let others = 0;
  for (const character of text) {
    if (CJK_RANGE.test(character)) cjk += 1;
    else others += 1;
  }
  return cjk + Math.floor(others / 4);
}

/** The ledger's data types live in the model (one-way layering, like every
 *  other report type); re-exported here so the CLI's import surface stays put. */
export type { CostSkillLine, CostPathGroup, CostLedgerError, CostSuggestion, CostScatteredSuggestion, CostSuggestions, CostLedger } from '../model/index.js';

/** The ledger scoped to a set of physical runtime dirs — the preset apply's
 *  tail-line shape (ADR-0019): one token count per applied path, summed. */
export type ScopedPathCost = { method: 'char-approx'; tokens: number; paths: Array<{ runtimeDir: string; tokens: number }> };

/** One counted distribution entry in flight: the index facts the suggestion

/** One counted distribution entry in flight: the index facts the suggestion
 *  layers need beside the counted line. */
type CountedEntry = {
  runtimeDir: string;
  kind: DistributionTargetKind;
  targetRoot: string;
  agents: string[];
  line: CostSkillLine;
};

export class CostLedgerService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly registry: RegistryService,
    private readonly distribute: DistributeService,
  ) {}

  /** Compute the whole ledger. Read-only over the index, the registry, and the
   *  runtime trees. `top` bounds the expensive-descriptions layer (default 5). */
  ledger(top = 5): CostLedger {
    const registrySkills = this.registry.load().skills ?? {};
    const groups = new Map<string, { kind: DistributionTargetKind; agents: Set<string>; skills: CostSkillLine[] }>();
    const errors: CostLedgerError[] = [];
    const managedPaths = new Set<string>();
    const counted: CountedEntry[] = [];

    for (const record of this.distribute.listIndex()) {
      for (const entry of record.entries) {
        const runtimePath = path.resolve(entry.runtimePath);
        const runtimeDir = path.dirname(runtimePath);
        managedPaths.add(runtimePath);
        const group = groups.get(runtimeDir) ?? { kind: record.kind, agents: new Set<string>(), skills: [] };
        entry.agents.forEach((id) => group.agents.add(id));
        groups.set(runtimeDir, group);

        const outcome = this.countEntry(entry.skill, runtimePath, registrySkills[entry.skill]);
        if ('error' in outcome) {
          errors.push(outcome.error);
          continue;
        }
        group.skills.push(outcome.line);
        counted.push({ runtimeDir, kind: record.kind, targetRoot: record.targetRoot, agents: entry.agents, line: outcome.line });
      }
    }

    const paths = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([runtimeDir, group]) => ({
        runtimeDir,
        kind: group.kind,
        agents: [...group.agents].sort(),
        tokens: group.skills.reduce((total, line) => total + line.tokens, 0),
        skills: group.skills,
      }));

    return {
      method: 'char-approx',
      totalTokens: paths.reduce((total, group) => total + group.tokens, 0),
      unmanaged: this.countUnmanaged(managedPaths, groups.keys()),
      paths,
      suggestions: this.suggestions(counted, top),
      errors,
    };
  }

  /** The ledger's counting scoped to specific physical runtime dirs — the tail
   *  line of a preset apply (ADR-0019 US20): what the 档位 just switched costs
   *  per message. Read-only like the rest of the ledger; shared paths counted
   *  once, per the ledger's grouping. */
  pathCost(runtimeDirs: readonly string[]): ScopedPathCost {
    const wanted = new Set(runtimeDirs.map((dir) => path.resolve(dir)));
    // top=0: only the path groups are needed here, never the suggestion layers.
    const paths = this.ledger(0).paths
      .filter((group) => wanted.has(path.resolve(group.runtimeDir)))
      .map(({ runtimeDir, tokens }) => ({ runtimeDir, tokens }));
    return { method: 'char-approx', tokens: paths.reduce((total, group) => total + group.tokens, 0), paths };
  }

  /** One entry's cost from the runtime SKILL.md actually present — index says
   *  where, the file says how much. Defects count 0 and surface as errors;
   *  archived-but-distributed entries fall back to their archived hub copy
   *  (same frontmatter the distribution laid down) so they stay counted (US11). */
  private countEntry(skill: string, runtimePath: string, registryEntry: RegistryEntry | undefined): { line: CostSkillLine } | { error: CostLedgerError } {
    // The shared predicate keeps doctor's broken-links report and this errors
    // section in agreement (US26).
    const broken = isBrokenSymlink(this.fs, runtimePath);
    let text = this.readSkillMd(path.join(runtimePath, 'SKILL.md'));
    if (text === null && registryEntry?.archived && typeof registryEntry.archive_path === 'string') {
      text = this.readSkillMd(path.resolve(this.home.root, registryEntry.archive_path, 'SKILL.md'));
    }
    if (text === null) {
      return { error: { skill, runtimePath, reason: broken ? 'broken symlink' : 'SKILL.md unreadable' } };
    }
    const { data } = parseSkillFrontmatter(text);
    const name = readableString(data.name) ?? skill;
    const description = readableString(data.description);
    const nameTokens = charApproxTokens(name);
    const descriptionTokens = description === null ? 0 : charApproxTokens(description);
    return {
      line: {
        skill,
        tokens: nameTokens + descriptionTokens,
        nameTokens,
        descriptionTokens,
        ...(description === null ? { incomplete: true } : {}),
        ...(registryEntry?.archived ? { archived: true } : {}),
      },
    };
  }

  /** A readable SKILL.md's text, or null — absent and unreadable are the same
   *  defect from the ledger's point of view. */
  private readSkillMd(skillMd: string): string | null {
    if (this.fs.kind(skillMd) !== 'file') return null;
    try {
      return this.fs.readText(skillMd);
    } catch {
      return null;
    }
  }

  /** The three suggestion layers, all report-only. Archived entries head the
   *  list and are excluded from the other layers — one remedy, one command. */
  private suggestions(counted: ReadonlyArray<CountedEntry>, top: number): CostSuggestions {
    const archived = counted
      .filter((item) => item.line.archived)
      .map((item) => ({ skill: item.line.skill, runtimeDir: item.runtimeDir, tokens: item.line.tokens, command: this.undistributeCommand(item.kind, item.targetRoot, item.line.skill, item.agents) }));

    const topDescriptions = counted
      .filter((item) => !item.line.archived)
      .sort((a, b) => b.line.descriptionTokens - a.line.descriptionTokens || a.line.skill.localeCompare(b.line.skill))
      .slice(0, Math.max(0, top))
      .map((item) => ({ skill: item.line.skill, runtimeDir: item.runtimeDir, tokens: item.line.descriptionTokens, command: this.undistributeCommand(item.kind, item.targetRoot, item.line.skill, item.agents) }));

    const bySkill = new Map<string, typeof counted>();
    for (const item of counted) {
      if (item.line.archived) continue; // the archived recall already covers every path
      bySkill.set(item.line.skill, [...(bySkill.get(item.line.skill) ?? []), item]);
    }
    const scattered = [...bySkill.entries()]
      .filter(([, items]) => new Set(items.map((item) => item.runtimeDir)).size > 1)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([skill, items]) => {
        const paths = [...new Map(items.map((item) => [item.runtimeDir, item])).entries()].sort(([a], [b]) => a.localeCompare(b));
        return {
          skill,
          runtimeDirs: paths.map(([runtimeDir]) => runtimeDir),
          commands: paths.map(([runtimeDir, item]) => this.undistributeCommand(item.kind, item.targetRoot, skill, item.agents)),
        };
      });

    return { archived, topDescriptions, scattered };
  }

  /** The verbatim recall command — including the required `--to` (and
   *  `--project` for project paths) and the entry's own agents, so running it
   *  recalls exactly this distribution (US9). */
  private undistributeCommand(kind: DistributionTargetKind, targetRoot: string, skill: string, agents: readonly string[]): string {
    const project = kind === 'project' ? ` --project ${shellWord(targetRoot)}` : '';
    const agent = agents.length > 0 ? ` --agent ${agents.join(' ')}` : '';
    return `skills-manager undistribute --to ${kind}${project}${agent} --skill ${skill}`;
  }

  /** Unmanaged (foreign) entries in known runtime roots — the same roots
   *  distribute's foreign count walks, so doctor's number and the ledger's
   *  never disagree. */
  private countUnmanaged(managedPaths: ReadonlySet<string>, roots: Iterable<string>) {
    let unmanaged = 0;
    for (const root of roots) {
      if (this.fs.kind(root) !== 'directory') continue;
      for (const entry of this.fs.readDirectory(root)) {
        if (!managedPaths.has(path.join(root, entry.name))) unmanaged += 1;
      }
    }
    return unmanaged;
  }
}

/** `≈`-prefixed magnitude with `1.2k`-style abbreviation — the display form of
 *  every token number the ledger shows, so an approximation is never mistaken
 *  for an exact count (US13). Shared by the CLI and dashboard adapters. */
export function formatApproxTokens(tokens: number): string {
  if (tokens < 1000) return `≈${tokens}`;
  const thousands = tokens / 1000;
  if (thousands < 100) {
    const abbreviated = thousands.toFixed(1);
    return `≈${abbreviated.endsWith('.0') ? abbreviated.slice(0, -2) : abbreviated}k`;
  }
  return `≈${Math.round(thousands)}k`;
}

/** A trimmed non-empty string value, or null — an absent anchor counts as absent. */
function readableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Quote a path only when the shell would split it. */
function shellWord(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}
