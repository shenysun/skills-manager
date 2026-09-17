import path from 'node:path';
import type { SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitDiffEntry, GitPort } from '../ports/git.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { EMPTY_REGISTRY_FILE } from './skill-home-service.js';

/**
 * Hub git-ification for multi-machine sync (ADR-0020). The hub itself becomes
 * a git repository; push/pull over a user-chosen remote is the sync mechanism.
 * `init` is deliberately thin: git init (or adopt the user's existing repo —
 * being a step ahead is not an error), append-only `.gitignore`
 * reconciliation, one baseline commit when the tree has anything to commit,
 * optional remote attach. The result reports exactly what was done — zero
 * omission — so the command never surprises the operator.
 */
export class SyncService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly git: GitPort,
    private readonly home: SkillHome,
  ) {}

  init(options: { remote?: string } = {}): SyncInitResult {
    this.assertGitAvailable();
    const root = this.home.root;
    const adopted = this.gitified();
    if (!adopted) this.git.initRepo(root);
    const ignoreLinesAdded = this.reconcileGitignore();
    const baselineCommit = this.baselineCommitIfNeeded(root);
    const remote = this.attachRemoteIfGiven(root, options.remote);
    return { mode: adopted ? 'adopted' : 'initialized', gitInitRan: !adopted, ignoreLinesAdded, baselineCommit, remote };
  }

  /** Read-only, zero-network status probe (US-15/16/17). A hub without `.git/`
   *  is not an error here — status answers "not yet, run init" and exits 0
   *  (unlike push/pull, whose nonzero exit signals a blocked operation). */
  status(): SyncStatusResult {
    const root = this.home.root;
    if (!this.gitified()) {
      return { home: root, gitified: false, hint: 'Run `sync init` to git-ify the hub for multi-machine sync.' };
    }
    if (!this.git.available()) {
      throw new SkillsManagerError(
        'sync_git_missing',
        'System git is not available, but the hub is a git repository and `sync status` reads it with git. Install git and make sure it is on PATH.',
      );
    }
    // Strict porcelain first: it validates the repo, so the reads after it never
    // mistake a broken repo for "no upstream" / "no commits".
    const porcelain = this.git.statusPorcelain(root);
    const dirtyFiles = porcelain === '' ? 0 : porcelain.split('\n').length;
    const remote = this.git.remoteUrl(root, 'origin');
    const aheadBehind = this.git.aheadBehind(root);
    const last = this.git.log(root, 1)[0] ?? null;
    return {
      home: root,
      gitified: true,
      remote,
      dirtyFiles,
      aheadBehind: aheadBehind === null ? null : { ...aheadBehind, basis: 'last-fetch' as const },
      lastCommit: last === null ? null : { sha: shortSha(last.hash), message: last.subject },
    };
  }

  /** One-command sync (US-6..US-10): stage everything, make one summary
   *  commit, push. The gates run before anything is staged: a hub without
   *  `.git/` or without origin is a blocked operation (nonzero), never a
   *  partial one. Whether the remote already matches is left to git itself —
   *  push's own "Everything up-to-date" answer is authoritative, so no empty
   *  commit is ever created to "push something". */
  push(): SyncPushResult {
    this.assertGitAvailable();
    const root = this.home.root;
    const remote = this.assertSyncable(root, 'push does not: there is nothing to push');
    let commit: SyncPushResult['commit'];
    try {
      commit = this.summaryCommitIfNeeded(root);
    } catch (error) {
      throw withUnbornHeadGuidance(withGitIdentityGuidance(error), root);
    }
    const output = this.git.pushOrigin(root);
    return { remote, commit, upToDate: EVERYTHING_UP_TO_DATE.test(output) };
  }

  /** Stage all + one summary commit whose message counts what changed at the
   *  skill level (US-7); a clean tree commits nothing — idempotence, no empty
   *  commits (US-8). */
  private summaryCommitIfNeeded(root: string): SyncPushResult['commit'] {
    if (this.git.statusPorcelain(root) === '') return null;
    this.git.addAll(root);
    const changes = this.git.diffNameStatus(root, 'HEAD');
    if (changes.length === 0) return null;
    const message = summaryMessage(changes, new Set(this.git.lsTreeNames(root, 'HEAD', 'skills')));
    try {
      return { sha: shortSha(this.git.commit(root, message)), message };
    } catch (error) {
      throw withGitIdentityGuidance(error);
    }
  }

  /** Fetch + merge (US-11..US-14). The gates run before any network or merge
   *  action: pull never runs over a dirty tree, never stashes, and never
   *  decides a conflict over user data — git's own nonzero exit plus manual
   *  `git -C <hub>` guidance is the whole story there. The single exception
   *  (ticket 07): when the local side is provably nothing but the init
   *  baseline's empty placeholder registry, the remote's real registry
   *  supersedes it automatically — a placeholder is not user data. */
  pull(): SyncPullResult {
    this.assertGitAvailable();
    const root = this.home.root;
    const remote = this.assertSyncable(root, 'pull does not: there is nothing to pull into');
    if (this.git.statusPorcelain(root) !== '') {
      throw new SkillsManagerError(
        'sync_dirty_tree',
        `The working tree has uncommitted changes — pull refuses to run over them and never stashes. Push them first (\`sync push\`), or handle them yourself: git -C ${root} status`,
      );
    }
    // Pre-merge HEAD anchors the pull statistics; a repo that passed the clean
    // tree gate on a valid hub always has commits (its files would otherwise
    // still be untracked), so the null arm is a defensive empty-base reading.
    const preHead = this.git.log(root, 1)[0]?.hash ?? null;
    this.git.fetchOrigin(root);
    try {
      const output = this.git.merge(root, this.mergeTarget(root));
      return { remote, upToDate: ALREADY_UP_TO_DATE.test(output), stats: this.pullStats(root, preHead), registryPlaceholderSuperseded: null };
    } catch (error) {
      if (!this.reconcilePlaceholderRegistry(root, error)) throw withMergeConflictGuidance(error, root);
      return { remote, upToDate: false, stats: this.pullStats(root, preHead), registryPlaceholderSuperseded: true };
    }
  }

  /** The one conflict the tool settles itself (ticket 07): the registry.yaml
   *  clash between the empty placeholder `ensure()` baselines on a fresh hub
   *  and the remote's real registry — without this, every real hub's first
   *  pull on a new machine dies in it. The preconditions make the local side
   *  provably user-data-free, so no merge decision about user content is
   *  being made: the conflicted path set is exactly registry.yaml, the local
   *  content is the byte-exact placeholder, and local history is nothing but
   *  the init baseline commit (no push, no hand commit — nothing of the
   *  user's exists locally to lose; the remote's real registry simply
   *  supersedes the empty placeholder). Every other conflict shape — other
   *  paths involved, a real local registry, or any history beyond the
   *  baseline (including a pushed "removed the last skill", whose serialized
   *  registry is byte-identical to the placeholder) — is genuine divergence
   *  and stays exactly as git left it. Returns true when the placeholder was
   *  superseded, false when the conflict is not this case. */
  private reconcilePlaceholderRegistry(root: string, error: unknown): boolean {
    if (!isConflictedMerge(error)) return false;
    const conflicts = this.git.statusPorcelain(root)
      .split('\n')
      .filter((line) => CONFLICT_CODES.has(line.slice(0, 2)))
      .map((line) => line.slice(3));
    if (conflicts.length !== 1 || conflicts[0] !== REGISTRY_PATH) return false;
    if (this.git.showFile(root, 'HEAD', REGISTRY_PATH) !== EMPTY_REGISTRY_FILE) return false;
    const history = this.git.log(root, 2);
    if (history.length !== 1 || history[0].subject !== BASELINE_COMMIT_MESSAGE) return false;
    try {
      this.git.checkoutConflictSide(root, 'theirs', REGISTRY_PATH);
      this.git.addAll(root);
      this.git.commitNoEdit(root);
    } catch (resolutionError) {
      // A failure mid-reconciliation leaves the merge unfinished — the same
      // manual-resolution guidance as an untouched conflict gets the operator
      // out (identity refusals keep their own, more specific guidance).
      if (isGitIdentityRefusal(resolutionError)) throw withGitIdentityGuidance(resolutionError);
      throw withMergeConflictGuidance(resolutionError, root);
    }
    return true;
  }

  /** The hard gates every content-moving sync command shares (push, pull): a
   *  hub without `.git/` or without origin is a blocked operation (nonzero),
   *  never a partial one. The verb tail keeps each command's refusal honest
   *  about what exactly it cannot do. */
  private assertSyncable(root: string, verbTail: string): string {
    if (!this.gitified()) {
      throw new SkillsManagerError(
        'sync_not_gitified',
        `The hub is not a git repository yet — run \`sync init\` first (status exits 0 here, ${verbTail}).`,
      );
    }
    const remote = this.git.remoteUrl(root, 'origin');
    if (remote === null) {
      throw new SkillsManagerError(
        'sync_no_remote',
        `No remote origin configured — attach one with \`sync init --remote <url>\`, or run: git -C ${root} remote add origin <url>`,
      );
    }
    return remote;
  }

  /** What this machine merges: its own upstream when push has configured one
   *  (that is where its pushes land), otherwise the remote's HEAD branch —
   *  the new-machine arm, before any local push has set up tracking. */
  private mergeTarget(root: string): string {
    if (this.git.aheadBehind(root) !== null) return '@{upstream}';
    const branch = this.git.remoteHeadBranch(root);
    if (branch === null) {
      throw new SkillsManagerError(
        'sync_remote_head_unresolved',
        `The remote's HEAD branch could not be resolved — nothing has been pushed to it yet. Run \`sync push\` from a machine that has content first, or inspect the remote yourself: git -C ${root} ls-remote origin`,
      );
    }
    return `origin/${branch}`;
  }

  /** Skill-level view of what the merge brought in (US-14), on the same
   *  counting rules as the push summary: pre-merge HEAD is the base, so a
   *  skill the remote added reads as added and a remotely-changed one as
   *  updated. */
  private pullStats(root: string, preHead: string | null): SkillDiffSummary {
    if (preHead === null) {
      // A registry.yaml found on disk after the merge must have arrived with
      // it: the clean-tree gate ran before, and an untracked registry would
      // have been a dirty tree — so presence here really means "changed".
      return {
        added: this.git.lsTreeNames(root, 'HEAD', 'skills'),
        updated: [],
        removed: [],
        registryChanged: this.fs.exists(path.join(root, 'registry.yaml')),
        others: 0,
      };
    }
    return summarizeSkills(
      this.git.diffNameStatus(root, `${preHead}..HEAD`),
      new Set(this.git.lsTreeNames(root, preHead, 'skills')),
    );
  }

  /** Shared preflight for every git-touching sync command: a missing git is a
   *  clean error, not spawn noise. status() keeps its own wording because it
   *  explains why a read-only probe still needs git. */
  private assertGitAvailable(): void {
    if (!this.git.available()) {
      throw new SkillsManagerError(
        'sync_git_missing',
        'System git is not available, but `sync` relies on it (no third-party tools are shelled out to). Install git and make sure it is on PATH.',
      );
    }
  }

  /** Adoption probe shared by init (adopt vs create) and status (git-ified or
   *  hint): a `.git/` entry is the same signal in both. */
  private gitified(): boolean {
    return this.fs.kind(path.join(this.home.root, '.git')) !== 'missing';
  }

  /** Canonical ignore policy (ADR-0020): `.backups/` and `.skills/` are
   *  machine-local (rollback snapshots, distribution index, activity log) and
   *  never sync. Missing lines are appended; user lines are never rewritten. */
  private reconcileGitignore(): string[] {
    const ignorePath = path.join(this.home.root, '.gitignore');
    const existing = this.fs.exists(ignorePath) ? this.fs.readText(ignorePath) : '';
    // Git ignores trailing spaces in a pattern but treats leading spaces as
    // significant — so "already present" matches on rstrip only; an indented
    // `  .backups/` is a different pattern and still counts as missing.
    const present = new Set(existing.split('\n').map((line) => line.replace(/\s+$/, '')));
    const missing = CANONICAL_IGNORE_LINES.filter((line) => !present.has(line));
    if (missing.length === 0) return [];
    let addition = missing.map((line) => `${line}\n`).join('');
    if (existing === '') addition = `${GITIGNORE_HEADER}${addition}`;
    else if (!existing.endsWith('\n')) addition = `\n${addition}`;
    this.fs.appendText(ignorePath, addition);
    return [...missing];
  }

  /** One baseline commit when the tree carries any uncommitted content — that
   *  is what leaves the hub clean for the pull/push cycle. Conscious call
   *  (broader than US-3's "untracked content" wording): the `.gitignore`
   *  append itself dirties the tree, and a baseline that left modifications
   *  behind would defeat pull's clean-tree precondition; the zero-omission
   *  output always states that the commit happened. Nothing to commit means
   *  no commit: idempotent reruns never create empty ones. */
  private baselineCommitIfNeeded(root: string): string | null {
    if (this.git.statusPorcelain(root) === '') return null;
    this.git.addAll(root);
    try {
      return shortSha(this.git.commit(root, BASELINE_COMMIT_MESSAGE));
    } catch (error) {
      throw withGitIdentityGuidance(error);
    }
  }

  /** `--remote` attaches origin. An identical existing origin is a no-op; a
   *  different one is the user's decision to make, not ours — error with the
   *  manual command instead of silently repointing. */
  private attachRemoteIfGiven(root: string, remote: string | undefined): SyncInitResult['remote'] {
    if (!remote) return null;
    const existing = this.git.remoteUrl(root, 'origin');
    if (existing === remote) return { attached: false, url: existing };
    if (existing !== null) {
      throw new SkillsManagerError(
        'sync_remote_conflict',
        `Remote origin already points at ${existing}, refusing to repoint it to ${remote}. Change it yourself with: git -C ${root} remote set-url origin ${remote}`,
      );
    }
    this.git.remoteAdd(root, 'origin', remote);
    return { attached: true, url: remote };
  }
}

/** Machine-local state excluded from sync (ADR-0020). */
export const CANONICAL_IGNORE_LINES = ['.backups/', '.skills/'] as const;

/** Git's default abbreviation length — the short SHA every report shows. */
const shortSha = (sha: string): string => sha.slice(0, 7);

/** The one-line push outcome git prints on stderr when there is nothing to send. */
const EVERYTHING_UP_TO_DATE = /Everything up-to-date/;

/** The one-line merge outcome git prints when the remote brought nothing new. */
const ALREADY_UP_TO_DATE = /Already up to date\./;

/** porcelain's unmerged XY codes — the paths a conflicted merge left for
 *  someone to decide (pull's placeholder probe only ever sees AA in practice;
 *  the full set keeps the read honest). */
const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** The hub-root-relative registry path, as git sees it (one definition for
 *  pull's placeholder probe and conflict-set check). */
const REGISTRY_PATH = 'registry.yaml';

/** The one commit `sync init`'s baseline leaves — pull's placeholder probe
 *  requires local history to be exactly this and nothing else (shared with
 *  baselineCommitIfNeeded so the probe and the writer cannot drift). */
const BASELINE_COMMIT_MESSAGE = 'sync: baseline commit';

/** The shared "did this merge die in conflicts?" read — one predicate so the
 *  placeholder probe and the manual-guidance mapper cannot drift apart. */
const isConflictedMerge = (error: unknown): boolean => /CONFLICT|Automatic merge failed/i.test(errorMessage(error));

/** The "who are you" half of git's identity refusal, matched before mapping —
 *  so reconciliation failures keep the identity guidance, not the generic one. */
const isGitIdentityRefusal = (error: unknown): boolean =>
  /tell me who you are|Author identity unknown/i.test(errorMessage(error));

/** The commit message a push leaves behind (US-7): skill-level counts (a skill
 *  touched in three files is one entry), a registry flag, and an honest bucket
 *  for everything else (collections/, user .gitignore edits). "Added" means
 *  the skill's directory is absent at HEAD — a new file inside an existing
 *  skill is an update, which is why the caller passes HEAD's skill listing.
 *  Zero segments are omitted — the message stays one readable line. */
function summaryMessage(changes: GitDiffEntry[], skillsAtHead: Set<string>): string {
  const { added, updated, removed, registryChanged, others } = summarizeSkills(changes, skillsAtHead);
  const parts = [
    ...(added.length > 0 ? [`${added.length} added`] : []),
    ...(updated.length > 0 ? [`${updated.length} updated`] : []),
    ...(removed.length > 0 ? [`${removed.length} removed`] : []),
    ...(registryChanged ? ['registry changed'] : []),
    ...(others > 0 ? [`${others} other file(s)`] : []),
  ];
  return `sync: ${parts.join(', ') || 'no content changes'}`;
}

/** Skill-level classification of one diff — the shared report shape behind
 *  push's commit message and pull's statistics (one counting rule, two
 *  reports). */
export type SkillDiffSummary = {
  /** Skill names whose directory is absent at the diff's base. */
  added: string[];
  /** Skill names present at the base and touched by the diff. */
  updated: string[];
  /** Skill names the diff deleted. */
  removed: string[];
  /** Whether registry.yaml appears in the diff. */
  registryChanged: boolean;
  /** Diff entries outside the canonical spaces (collections/, .gitignore, …). */
  others: number;
};

/** `skillsAtBase` is the skill listing at the diff's base ref: a skill absent
 *  there is added, one present is updated. */
function summarizeSkills(changes: GitDiffEntry[], skillsAtBase: Set<string>): SkillDiffSummary {
  const added = new Set<string>();
  const updated = new Set<string>();
  const removed = new Set<string>();
  let registryChanged = false;
  let others = 0;
  for (const entry of changes) {
    // A rename whose two ends live in the same skill is an update to that
    // skill — counting a removal would claim a skill disappeared when only a
    // file inside it moved.
    if (entry.code.startsWith('R')) {
      const oldSkill = skillNameOf(entry.paths[0]);
      if (oldSkill !== null && oldSkill === skillNameOf(entry.paths[1])) {
        updated.add(oldSkill);
        continue;
      }
    }
    // A cross-skill rename is a removal plus an addition at the skill level.
    const sides: Side[] = entry.code.startsWith('R')
      ? [[entry.paths[0], 'removed'], [entry.paths[1], 'added']]
      : [[entry.paths[0], entry.code.startsWith('D') ? 'removed' : 'added']];
    for (const [filePath, kind] of sides) {
      if (filePath === 'registry.yaml') { registryChanged = true; continue; }
      const skill = skillNameOf(filePath);
      if (skill === null) { others += 1; continue; }
      if (kind === 'removed') removed.add(skill);
      else if (skillsAtBase.has(skill)) updated.add(skill);
      else added.add(skill);
    }
  }
  return { added: [...added], updated: [...updated], removed: [...removed], registryChanged, others };
}

/** One side of a diff entry: the path and what happened to it. */
type Side = [filePath: string, kind: 'added' | 'removed'];

/** The single coercion every git-failure mapper starts with. */
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** An unborn HEAD (manual `git init`, never committed) turns every HEAD-based
 *  read into a raw git refusal — push maps it to the same guidance as the
 *  other hard gates instead of surfacing git's internals. */
function withUnbornHeadGuidance(error: unknown, root: string): unknown {
  const message = errorMessage(error);
  if (/unknown revision|bad revision|ambiguous argument 'HEAD'/i.test(message)) {
    return new SkillsManagerError(
      'sync_no_commits',
      `The hub repository has no commits yet, so there is nothing to push against — run \`sync init\` (it adopts an existing repo and makes the baseline commit), or commit manually: git -C ${root} add -A && git -C ${root} commit`,
    );
  }
  return error;
}

/** `skills/<name>/...` → `<name>`; anything else (collections/, .gitignore, …)
 *  is not a canonical skill. registry.yaml is classified by the caller — it is
 *  its own message dimension. */
function skillNameOf(filePath: string): string | null {
  const match = filePath.match(/^skills\/([^/]+)\//);
  return match === null ? null : match[1];
}

const GITIGNORE_HEADER = '# skills-manager sync: machine-local state, never synced (ADR-0020)\n';

/** Git's "who are you" refusal becomes guidance — the tool never configures
 *  git identity on the user's behalf (US-10's discipline applies to every
 *  commit we make, including init's baseline). */
function withGitIdentityGuidance(error: unknown): unknown {
  if (isGitIdentityRefusal(error)) {
    return new SkillsManagerError(
      'sync_git_identity',
      'Git identity (user.name / user.email) is not configured, and skills-manager does not configure it for you. Set it globally, then retry:\n  git config --global user.name "Your Name"\n  git config --global user.email "you@example.com"',
    );
  }
  return error;
}

/** A conflicted merge becomes manual-resolution guidance (US-12): the
 *  conflict state stays exactly as git left it — the operator keeps every
 *  merge decision. Any other merge failure passes through untouched. */
function withMergeConflictGuidance(error: unknown, root: string): unknown {
  if (isConflictedMerge(error)) {
    return new SkillsManagerError(
      'sync_merge_conflict',
      `Merge conflict — skills-manager never makes merge decisions for you. The conflicted files are listed by:\n  git -C ${root} status\nResolve them by hand, then finish the merge yourself:\n  git -C ${root} add -A && git -C ${root} commit`,
    );
  }
  return error;
}

export type SyncInitResult = {
  /** `adopted` = the hub already had a `.git/` (history kept); `initialized` = fresh `git init`. */
  mode: 'initialized' | 'adopted';
  gitInitRan: boolean;
  /** Canonical `.gitignore` lines this run appended (empty when none were missing). */
  ignoreLinesAdded: string[];
  /** Short SHA of the baseline commit, or null when the tree was already clean. */
  baselineCommit: string | null;
  /** Remote attach outcome; null when `--remote` was not given. */
  remote: { attached: boolean; url: string } | null;
};

/** One push cycle's outcome. `commit` is null when the tree was clean (nothing
 *  to summarize — no empty commits); `upToDate` is git's own "nothing was
 *  sent" answer, which is what "already in sync" means here (US-8). */
export type SyncPushResult = {
  /** The origin URL that was pushed to. */
  remote: string;
  /** The summary commit made this run, or null when the tree was clean. */
  commit: { sha: string; message: string } | null;
  /** True when the remote already had everything (nothing was sent). */
  upToDate: boolean;
};

/** One read-only snapshot of the hub's sync posture. The git-ified arm carries
 *  every dimension with null (never an omitted key) for "not there yet" — the
 *  same zero-omission bar as init's report. */
export type SyncStatusResult =
  | { home: string; gitified: false; hint: string }
  | {
      home: string;
      gitified: true;
      /** origin URL, or null when no remote is configured. */
      remote: string | null;
      /** Working-tree entries git would report (`status --porcelain` line count). */
      dirtyFiles: number;
      /** Off the remote-tracking ref, `basis: 'last-fetch'` — status never fetches.
       *  Null when no upstream tracking ref is configured (nothing pushed yet). */
      aheadBehind: { ahead: number; behind: number; basis: 'last-fetch' } | null;
      /** HEAD's short SHA + subject, or null when the repo has no commits. */
      lastCommit: { sha: string; message: string } | null;
    };

/** What one pull brought in, on the push summary's counting rules (US-14). */
export type SyncPullResult = {
  /** The origin URL that was pulled from. */
  remote: string;
  /** True when the merge reported nothing to merge (git's own answer). */
  upToDate: boolean;
  /** Skill-level diff pre-merge HEAD → post-merge HEAD. */
  stats: SkillDiffSummary;
  /** True when the merge clashed on registry.yaml and the local side was
   *  provably the init baseline's empty placeholder (ticket 07) — the
   *  remote's real registry superseded it. Null on every ordinary pull. */
  registryPlaceholderSuperseded: true | null;
};
