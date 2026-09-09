import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { GitHubApiError, type GitHubApiPort, type RepoTree } from '../ports/github-api.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { parseGitHubRepoRef } from './source-service.js';
import { appendDetectionFailure } from './detection-log.js';

const execFileAsync = promisify(execFileCb);

/** Non-GitHub detection seam: resolves the head SHA of `url` at `ref`
 *  (ls-remote; `null` ref means HEAD). Returns null when the command succeeds
 *  but resolves no head (missing ref); throws on transport failure — the
 *  detection layer turns that into an explicit failed row, never silence. */
export type RemoteHeadResolver = (url: string, ref: string | null) => Promise<string | null>;

export async function gitLsRemoteHead(url: string, ref: string | null): Promise<string | null> {
  const args = ref ? ['ls-remote', url, ref] : ['ls-remote', url, 'HEAD'];
  const { stdout } = await execFileAsync('git', args, { timeout: 15000 });
  return stdout.trim().split('\t')[0] || null;
}

/** Per-row detection outcome (ADR-0013): 'ok' means hasUpdate is a real diff;
 *  'failed' means hasUpdate is meaningless (see the hub detection log); 'skipped'
 *  means the row was not part of this detection round (no source, no anchor,
 *  or an upstream path the tree listing no longer contains). */
export type DetectionStatus = 'ok' | 'failed' | 'skipped';

export type DetectionOutcome = { detection: DetectionStatus; hasUpdate: boolean };

/** The registry rows detection consumes (a structural slice of what
 *  registry.listSkills returns — CLI and dashboard both satisfy it). */
export type DetectionSkillRow = {
  name: string;
  source: { type?: string; url?: string | null; subpath?: string | null; ref?: string | null; upstream_tree?: string | null; upstream_commit?: string | null };
};

/** Core services detection touches (a structural slice of the runtime bundle). */
export type DetectionServices = {
  update: { plan(): { groups: Array<{ skills: Array<{ skill: string }> }> } };
  registry: { editSafeFields(skill: string, patch: { source: { upstream_tree: string } }): unknown };
  distribute: { fingerprint(skill: string): string | null };
  resolution: { root: string };
};

type GitHubDetectionGroup = {
  owner: string;
  repo: string;
  ref: string;
  skills: Array<{ name: string; subpath: string; anchoredTree: string | null }>;
};

export type DetectionDeps = {
  /** GitHub Trees API port; carries the gh-CLI probe verdict and its own per-owner/repo@ref TTL cache. */
  githubApi: GitHubApiPort;
  /** Non-GitHub head resolution; defaults to real `git ls-remote`. */
  remoteHead?: RemoteHeadResolver;
  /** Filesystem for local-source tree hashing and the detection log. */
  fs: FileSystemPort;
  /** Clock driving the remote-head TTL cache; injectable for tests. */
  now?: () => number;
};

const REMOTE_HEAD_TTL_MS = 5 * 60 * 1000;

/**
 * Upstream-freshness detection (ADR-0013), shared by the dashboard's live
 * state and the CLI's `update --check`: hasUpdate is a real content diff, not
 * plan membership. Extracted from the dashboard server so the conversation
 * layer can answer "is anything actually new" without the web (ticket
 * manager-skill-first/03). One instance owns the remote-head TTL cache —
 * keep it long-lived per app/process, not per request.
 */
export class DetectionService {
  private readonly remoteHeads = new Map<string, { sha: string | null; fetchedAt: number }>();

  constructor(private readonly deps: DetectionDeps) {}

  async detect(services: DetectionServices, skills: readonly DetectionSkillRow[]): Promise<Map<string, DetectionOutcome>> {
    const fs = this.deps.fs;
    const candidates = new Set(services.update.plan().groups.flatMap((group) => group.skills.map((skill) => skill.skill)));
    const outcomes = new Map<string, DetectionOutcome>();
    const homeRoot = services.resolution.root;
    const githubGroups = new Map<string, GitHubDetectionGroup>();
    const remoteHeadChecks: Array<Promise<void>> = [];
    for (const skill of skills) {
      const source = skill.source;
      if (!candidates.has(skill.name) || !source.url || !source.subpath) continue;
      if (source.type === 'local') {
        try {
          const sourceDir = path.resolve(source.url, source.subpath);
          const sourceHash = this.hashTree(fs, sourceDir);
          if (sourceHash === null) throw new Error(`local source directory is missing: ${sourceDir}`);
          outcomes.set(skill.name, { detection: 'ok', hasUpdate: sourceHash !== services.distribute.fingerprint(skill.name) });
        } catch (error) {
          outcomes.set(skill.name, { detection: 'failed', hasUpdate: false });
          this.recordDetectionFailure(fs, homeRoot, [skill.name], source.url, error, 'local');
        }
        continue;
      }
      const github = parseGitHubRepoRef(source.url);
      if (github) {
        // Per-source fan-in (ADR-0013): one fetchRepoTree per owner/repo@ref,
        // shared by every skill of that source — 60 skills / 23 repos stay
        // within rate limits even on the anonymous tier.
        const ref = source.ref || 'HEAD';
        const key = `${github.owner}/${github.repo}@${ref}`;
        const group = githubGroups.get(key) ?? { ...github, ref, skills: [] };
        group.skills.push({ name: skill.name, subpath: source.subpath, anchoredTree: source.upstream_tree ?? null });
        githubGroups.set(key, group);
        continue;
      }
      const url = source.url;
      const ref = source.ref;
      remoteHeadChecks.push((async () => {
        try {
          const remote = await this.remoteHeadSha(url, ref);
          if (remote === null) throw new Error(`ls-remote resolved no head for ${ref || 'HEAD'}`);
          if (!source.upstream_commit) {
            outcomes.set(skill.name, { detection: 'skipped', hasUpdate: false });
            return;
          }
          outcomes.set(skill.name, { detection: 'ok', hasUpdate: remote !== source.upstream_commit });
        } catch (error) {
          outcomes.set(skill.name, { detection: 'failed', hasUpdate: false });
          this.recordDetectionFailure(fs, homeRoot, [skill.name], ref ? `${url}@${ref}` : url, error, 'ls_remote');
        }
      })());
    }
    await Promise.all([
      ...remoteHeadChecks,
      ...[...githubGroups.values()].map(async (group) => {
        try {
          const tree = await this.deps.githubApi.fetchRepoTree(group.owner, group.repo, group.ref);
          this.applyRepoTree(services, group, tree, outcomes);
        } catch (error) {
          // Group-level isolation: the failure marks exactly this source's rows
          // and every other row / field of the payload stays intact.
          for (const member of group.skills) outcomes.set(member.name, { detection: 'failed', hasUpdate: false });
          this.recordDetectionFailure(fs, homeRoot, group.skills.map((member) => member.name), `${group.owner}/${group.repo}@${group.ref}`, error, 'github_api');
        }
      }),
    ]);
    return outcomes;
  }

  /** Successes are cached per url@ref for the TTL; failures are not — the next
   *  request retries, so a recovered network self-heals the row. */
  private async remoteHeadSha(url: string, ref: string | null | undefined): Promise<string | null> {
    const key = `${url}|${ref || ''}`;
    const cached = this.remoteHeads.get(key);
    const now = this.deps.now ?? Date.now;
    if (cached && now() - cached.fetchedAt < REMOTE_HEAD_TTL_MS) return cached.sha;
    const sha = await (this.deps.remoteHead ?? gitLsRemoteHead)(url, ref ?? null);
    this.remoteHeads.set(key, { sha, fetchedAt: now() });
    return sha;
  }

  /** Mirrors DistributeService.fingerprint's tree hashing so equal trees compare equal.
   *  Drift is caught behaviourally: dashboard-state tests require hasUpdate=false
   *  on a fresh install, which only holds while both algorithms agree. */
  private hashTree(fs: FileSystemPort, root: string): string | null {
    if (fs.kind(root) !== 'directory') return null;
    const hash = createHash('sha256');
    const walk = (prefix: string) => {
      const dir = prefix ? path.join(root, prefix) : root;
      for (const entry of fs.readDirectory(dir).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix ? path.join(prefix, entry.name) : entry.name;
        const full = path.join(root, relative);
        const kind = fs.kind(full);
        hash.update(relative);
        hash.update('\0');
        hash.update(kind);
        hash.update('\0');
        if (kind === 'file') hash.update(fs.readText(full));
        else if (kind === 'symlink') hash.update(fs.readlink(full));
        if (entry.kind === 'directory') walk(relative);
      }
    };
    walk('');
    return `sha256:${hash.digest('hex')}`;
  }

  /** Detection-as-calibration (ADR-0013): an uncalibrated entry (`upstream_tree`
   *  null) adopts the tree SHA this detection just observed. Idempotent and
   *  low-write by construction — calibrated entries never re-enter this path,
   *  so repeated refreshes only read. */
  private calibrateUpstreamTree(services: DetectionServices, skill: string, treeSha: string) {
    services.registry.editSafeFields(skill, { source: { upstream_tree: treeSha } });
  }

  /** Failure visibility: every detection failure marks its rows 'failed'
   *  (hasUpdate meaningless) and appends one JSON line to the hub's detection
   *  log. Never throws — a logging problem must not break detection. */
  private recordDetectionFailure(fs: FileSystemPort, homeRoot: string, names: string[], source: string, error: unknown, fallbackKind: string) {
    const detail = error instanceof GitHubApiError
      ? { kind: error.kind, message: error.message }
      : { kind: fallbackKind, message: error instanceof Error ? error.message : String(error) };
    appendDetectionFailure(fs, homeRoot, { source, skills: names, kind: detail.kind, message: detail.message });
  }

  /** Applies one fetched repo tree to the group's skills: uncalibrated entries
   *  adopt the observed SHA (no update flagged on first calibration), anchored
   *  entries compare — only a real content change lights hasUpdate. */
  private applyRepoTree(
    services: DetectionServices,
    group: GitHubDetectionGroup,
    tree: RepoTree,
    outcomes: Map<string, DetectionOutcome>,
  ) {
    for (const member of group.skills) {
      // Root-anchored skills compare the commit SHA (GitHub's recursive tree
      // has no root entry); sub-directory skills look up their own tree SHA.
      // A sub-directory the upstream no longer has cannot be judged — the row
      // reports 'skipped' rather than guessing.
      const upstreamTree = member.subpath ? tree.trees[member.subpath] : tree.commitSha;
      if (upstreamTree === undefined) {
        outcomes.set(member.name, { detection: 'skipped', hasUpdate: false });
        continue;
      }
      if (member.anchoredTree === null) {
        this.calibrateUpstreamTree(services, member.name, upstreamTree);
        outcomes.set(member.name, { detection: 'ok', hasUpdate: false });
        continue;
      }
      outcomes.set(member.name, { detection: 'ok', hasUpdate: upstreamTree !== member.anchoredTree });
    }
  }
}
