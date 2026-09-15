import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import type { DiscoveredSkill, SourceCheckout, SourceSpec } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import type { GitPort } from '../ports/git.js';
import type { DownloadRequest, DownloadResult, HttpDownloadPort } from '../ports/http-download.js';
import { DEFAULT_DOWNLOAD_REQUEST, unconfiguredHttpDownload } from '../ports/http-download.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName, parseSkillMarkdownMetadata } from '../../shared/validation.js';
import { type ArchiveLimits, DEFAULT_ARCHIVE_LIMITS } from './archive-safety.js';
import { extractZipArchive } from './archive-extract.js';
import { extractTarArchive } from './tar-extract.js';
import { judgeUrlPayload, predictFromContentType, predictFromUrlPath, type UrlPayloadFormat } from './url-payload.js';
import { parseMarketplacePlugins, type MarketplaceView, type ParsedMarketplacePlugin } from './marketplace-manifest.js';

const OWNER_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GITHUB_REPO_URL_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/;

/** Shared discovery output order: name, then subpath — stable across kinds. */
function byDiscoveryOrder(a: DiscoveredSkill, b: DiscoveredSkill): number {
  return a.name.localeCompare(b.name) || a.subpath.localeCompare(b.subpath);
}

/** Root manifest that marks a git repo as a Claude Code plugin marketplace
 *  (source-formats ticket 06). Detected after clone on subpath-free sources. */
export const MARKETPLACE_MANIFEST = '.claude-plugin/marketplace.json';

/** Hosts whose http(s) URLs keep the git-clone transport — the npx skills
 *  exclusion table (spec source-formats): every other http(s) URL is a
 *  direct-download source. Subdomains of a hosting domain stay on git too. */
const GIT_HOSTING_DOMAINS = ['github.com', 'gitlab.com', 'huggingface.co'];

function parseHttpUrl(input: string): URL | null {
  if (!/^https?:\/\//i.test(input)) return null;
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function isGitHostingDomain(hostname: string): boolean {
  return GIT_HOSTING_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

/** The shape of a source-checkout dir this tool mints and is allowed to sweep.
 *  One source of truth: minting goes through `mintCheckoutDirName`, and the
 *  sweepable pattern below shares the same prefix — change them together. */
const CHECKOUT_DIR_PREFIX = 'skills-source-';
/** Only dirs this tool minted (`skills-source-` + a randomUUID) are sweepable —
 *  a same-prefix name another tool chose in the shared tmpdir is never ours to
 *  delete (adversary M5). */
const SWEEPABLE_CHECKOUT_DIR = new RegExp(
  `^${CHECKOUT_DIR_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
);

function mintCheckoutDirName(): string {
  return `${CHECKOUT_DIR_PREFIX}${randomUUID()}`;
}

/** Canonical GitHub repo URL from owner + repo (strips a redundant `.git`). */
function githubRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`;
}

/**
 * Normalize a git source locator (`owner/repo` shorthand or GitHub repo URL) to the
 * canonical repo URL — the same shapes `normalize` accepts, minus the local-path
 * probe, so callers that mean "this is a git source" never misread a same-named
 * local directory as the identity.
 */
export function normalizeGitSourceUrl(input: string): string {
  const value = input.trim();
  if (OWNER_REPO_PATTERN.test(value)) {
    const [owner, repo] = value.split('/');
    return githubRepoUrl(owner, repo);
  }
  const githubRepo = value.match(GITHUB_REPO_URL_PATTERN);
  if (githubRepo) return githubRepoUrl(githubRepo[1], githubRepo[2]);
  return value;
}

/**
 * Parse a GitHub repo locator — `owner/repo` shorthand or a github.com repo
 * URL — into its owner/repo pair. Returns null for anything else (non-GitHub
 * URLs included). The single place that decides "what is a GitHub source".
 */
export function parseGitHubRepoRef(input: string): { owner: string; repo: string } | null {
  const value = input.trim();
  if (OWNER_REPO_PATTERN.test(value)) {
    const [owner, repo] = value.split('/');
    return { owner, repo: repo.replace(/\.git$/, '') };
  }
  const githubRepo = value.match(GITHUB_REPO_URL_PATTERN);
  if (githubRepo) return { owner: githubRepo[1], repo: githubRepo[2].replace(/\.git$/, '') };
  return null;
}

/** Per-checkout confirmations a caller may have already collected (spec US-12). */
export type CheckoutOptions = {
  /** The user explicitly confirmed a plain-http download. Without it, an
   *  http:// url source is refused before any byte is requested. */
  allowInsecureHttp?: boolean;
  /** The `--format` escape hatch (US-5): forces how a url payload is parsed,
   *  overriding the extension/Content-Type/magic judgment. Never changes the
   *  source dispatch — meaningless for non-url kinds and refused there. */
  format?: UrlPayloadFormat;
};

/** Whether checking out this spec would download over unencrypted http — the
 *  confirmation the CLI must collect before opening the checkout (US-12). */
export function isInsecureHttpSource(spec: SourceSpec): boolean {
  return spec.kind === 'url' && spec.repoUrl.startsWith('http://');
}

/** Checkout options for re-fetching a source the operator already registered
 *  (detection's re-download, update's reinstall): the US-12 confirmation
 *  happened when the source was introduced (add's `--yes`), so the re-check
 *  carries it forward instead of asking again. */
export const REGISTERED_SOURCE_RECHECK: CheckoutOptions = { allowInsecureHttp: true };

/** Swap the temp checkout path out of an error message before it reaches the
 *  conversation layer (adversary H1): the diagnostic value lives in git's
 *  stderr, not in the machine-local clone destination. */
function redactCheckoutPath(error: unknown, repoDir: string): unknown {
  if (error instanceof Error) {
    const message = error.message.split(repoDir).join('<temp-checkout>');
    if (message !== error.message) return new Error(message);
  }
  return error;
}

const ZIP_FILE_SUFFIX = /\.zip$/i;

/** Single-SKILL.md rule (npx skills parity, spec source-formats): the payload
 *  must be markdown whose frontmatter carries both name and description —
 *  anything else (an archive, an HTML page, prose) fails actionably instead
 *  of a guessed install. A frontmatter name that fails the existing
 *  untrusted-metadata checks (e.g. a path-traversal name) keeps that verdict.
 *  When the format was auto-judged (not forced via --format), the failure
 *  points at the escape hatch (US-6). */
function singleSkillMarkdownMetadata(payload: string, autoJudged: boolean): { name: string; description: string } {
  const hint = autoJudged ? ' If the payload is really an archive, pass --format zip or --format tar.' : '';
  let metadata;
  try {
    metadata = parseSkillMarkdownMetadata(payload);
  } catch (error) {
    if (error instanceof SkillsManagerError) throw error;
    throw new SkillsManagerError('url_payload_invalid', `The URL did not return a single SKILL.md — its frontmatter is not valid YAML.${hint}`);
  }
  if (!metadata.name || !metadata.description) {
    throw new SkillsManagerError('url_payload_invalid', `The URL did not return a single SKILL.md (markdown whose frontmatter carries both a name and a description).${hint}`);
  }
  return { name: metadata.name, description: metadata.description };
}

export class SourceService {
  constructor(
    private readonly fs: FileSystemPort,
    private readonly git: GitPort,
    private readonly tempRoot = os.tmpdir(),
    private readonly archiveLimits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
    private readonly http: HttpDownloadPort = unconfiguredHttpDownload(),
    private readonly downloadRequest: DownloadRequest = DEFAULT_DOWNLOAD_REQUEST,
  ) {}

  normalize(source: string): SourceSpec {
    const input = source.trim();
    if (!input) throw new SkillsManagerError('missing_source', 'Source is required');
    if (this.fs.exists(input)) {
      // An existing regular .zip file is an archive source (source-formats
      // ticket 02): one-shot snapshot, transported through a temp checkout —
      // not the local working-tree transport. Everything else existing stays
      // on the local path.
      if (ZIP_FILE_SUFFIX.test(input) && this.fs.targetKind(input) === 'file') {
        return { input, repoUrl: path.resolve(input), isLocal: false, kind: 'archive' };
      }
      return { input, repoUrl: path.resolve(input), isLocal: true, kind: 'local' };
    }

    if (OWNER_REPO_PATTERN.test(input)) {
      const [owner, repo] = input.split('/');
      return { input, repoUrl: githubRepoUrl(owner, repo), isLocal: false, kind: 'git' };
    }

    const githubTree = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/(.+)$/);
    if (githubTree) {
      const [, owner, repo, treeRest] = githubTree;
      return { input, repoUrl: githubRepoUrl(owner, repo), treeRest, isLocal: false, kind: 'git' };
    }

    const githubRepo = input.match(GITHUB_REPO_URL_PATTERN);
    if (githubRepo) {
      return { input, repoUrl: githubRepoUrl(githubRepo[1], githubRepo[2]), isLocal: false, kind: 'git' };
    }

    const httpUrl = parseHttpUrl(input);
    if (httpUrl) {
      // A git-hosting domain keeps the git fallback (current behavior); every
      // other http(s) URL is a direct-download source (ticket 03; well-known
      // index probing joins this branch in ticket 07, ahead of the download).
      return isGitHostingDomain(httpUrl.hostname)
        ? { input, repoUrl: input, isLocal: false, kind: 'git' }
        : { input, repoUrl: input, isLocal: false, kind: 'url' };
    }

    return { input, repoUrl: input, isLocal: false, kind: 'git' };
  }

  checkout(source: string, forcedRef?: string, options: CheckoutOptions = {}): SourceCheckout {
    const normalized = this.normalize(source);
    if (options.format !== undefined && normalized.kind !== 'url') {
      throw new SkillsManagerError('format_flag_misplaced', `--format only applies to url sources — this source is a ${normalized.kind} source, judged by its own transport.`);
    }
    if (normalized.isLocal) {
      const commit = this.fs.kind(path.join(normalized.repoUrl, '.git')) !== 'missing'
        ? this.git.revParseHead(normalized.repoUrl)
        : null;
      return { ...normalized, repoDir: normalized.repoUrl, commit };
    }

    if (normalized.kind === 'archive') {
      return this.mintTempCheckout((repoDir) => {
        extractZipArchive(this.fs, normalized.repoUrl, repoDir, this.archiveLimits);
        return { ...normalized, repoDir, commit: null };
      });
    }

    if (normalized.kind === 'url') {
      if (isInsecureHttpSource(normalized) && !options.allowInsecureHttp) {
        throw new SkillsManagerError(
          'insecure_http_unconfirmed',
          `${normalized.repoUrl} uses unencrypted http — a download could be tampered with in transit. Pass --yes to confirm, or use an https URL.`,
        );
      }
      return this.mintTempCheckout((repoDir) => this.checkoutUrlPayload(normalized, repoDir, options));
    }

    const tree: { ref?: string; baseSubpath?: string } = normalized.treeRest ? this.resolveGitHubTreeRef(normalized.repoUrl, normalized.treeRest) : (forcedRef ? { ref: forcedRef } : {});
    return this.mintTempCheckout((repoDir) => {
      // Every git source downloads shallow; the adapter maps the ref intent to --branch / init+fetch and lands HEAD there (ADR-0013).
      this.git.clone(normalized.repoUrl, repoDir, { ref: tree.ref });
      const commit = this.git.revParseHead(repoDir);
      // A repo whose root carries the plugin-marketplace manifest enters the
      // plugin discovery flow automatically (US-15) — unless the source names
      // an explicit subpath, which bypasses the manifest and scans SKILL.md
      // as an ordinary git source (US-18).
      const kind = tree.baseSubpath === undefined && this.fs.kind(path.join(repoDir, MARKETPLACE_MANIFEST)) === 'file'
        ? 'marketplace'
        : 'git';
      return { ...normalized, ...tree, repoDir, commit, kind };
    });
  }

  /** The url-source transport (ticket 04): the format judgment chain —
   *  extension predicts before the download (a .tar.bz2 URL is refused
   *  without one), Content-Type predicts for extension-less URLs, the
   *  downloaded bytes are the final judge. --format overrides the predictions
   *  but never the dispatch: the source kind stays url whatever the payload. */
  private checkoutUrlPayload(normalized: SourceSpec, repoDir: string, options: CheckoutOptions): SourceCheckout {
    const extensionPrediction = predictFromUrlPath(normalized.repoUrl);
    const downloaded = this.http.download(normalized.repoUrl, this.downloadRequest);
    const prediction = extensionPrediction ?? predictFromContentType(downloaded.headers.contentType);
    const format = options.format ?? judgeUrlPayload(downloaded.bytes, prediction);
    if (format === 'zip' || format === 'tar') {
      return this.checkoutArchivePayload(normalized, downloaded, format, repoDir);
    }
    const payload = downloaded.bytes.toString('utf8');
    const metadata = singleSkillMarkdownMetadata(payload, options.format === undefined);
    // The minimal skill tree — a single-file source lands as skills/<name>/SKILL.md
    // and discovery sees an ordinary directory tree (spec source-formats).
    const skillDir = path.join(repoDir, 'skills', metadata.name);
    this.fs.makeDirectory(skillDir);
    this.fs.writeText(path.join(skillDir, 'SKILL.md'), payload);
    return { ...normalized, repoDir, commit: null, httpHeaders: downloaded.headers };
  }

  /** An archive payload lands beside repo/ inside the minted temp dir, so the
   *  extractor size-checks it where it lies (US-10) and the checkout lifecycle
   *  sweeps the whole dir — no separate cleanup path. The full archive-safety
   *  policy applies to downloaded archives exactly as to local ones (no trust
   *  exemption for either). */
  private checkoutArchivePayload(normalized: SourceSpec, downloaded: DownloadResult, format: 'zip' | 'tar', repoDir: string): SourceCheckout {
    const payloadPath = path.join(path.dirname(repoDir), 'payload.bin');
    this.fs.writeBytes(payloadPath, downloaded.bytes);
    if (format === 'zip') extractZipArchive(this.fs, payloadPath, repoDir, this.archiveLimits);
    else extractTarArchive(this.fs, payloadPath, repoDir, this.archiveLimits);
    return { ...normalized, repoDir, commit: null, httpHeaders: downloaded.headers };
  }

  /** Shared temp-checkout scaffold for transport-based sources: mint a fresh
   *  skills-source-* dir and run the transport inside it. A transport that
   *  never became usable — clone or extraction — has its half-built temp
   *  removed and the checkout path redacted from the message before
   *  rethrowing (adversary M2/H1). */
  private mintTempCheckout(transport: (repoDir: string) => SourceCheckout): SourceCheckout {
    this.sweepStaleCheckouts();
    const repoDir = path.join(this.tempRoot, mintCheckoutDirName(), 'repo');
    this.fs.makeDirectory(path.dirname(repoDir));
    try {
      return transport(repoDir);
    } catch (error) {
      this.fs.removeTree(path.dirname(repoDir));
      throw redactCheckoutPath(error, repoDir);
    }
  }

  /**
   * Checkout scoped to a callback: the temp clone is removed when the callback
   * returns or throws (local sources pass through untouched). Errors crossing
   * out have the checkout path redacted (adversary H1). Callers that hold a
   * checkout beyond their turn must clean up with `release` instead — before
   * this, every checkout leaked its `skills-source-*` dir (ticket
   * manager-skill-first/02).
   *
   * The callback must be synchronous: an async callback's finally fires when
   * the promise is *created*, deleting the tree under the awaiting work
   * (adversary L4). The type cannot forbid it — the discipline is documented.
   */
  withCheckout<T>(source: string, forcedRef: string | undefined, use: (checkout: SourceCheckout) => T, options: CheckoutOptions = {}): T {
    const checkout = this.checkout(source, forcedRef, options);
    try {
      return use(checkout);
    } catch (error) {
      throw redactCheckoutPath(error, checkout.repoDir);
    } finally {
      this.release(checkout);
    }
  }

  /** Drop a checkout's temp clone; a no-op for local sources. */
  release(checkout: SourceCheckout): void {
    if (checkout.isLocal) return;
    const tempDir = path.dirname(checkout.repoDir);
    assertPathInside(tempDir, this.tempRoot);
    this.fs.removeTree(tempDir);
  }

  /**
   * Remove `skills-source-<uuid>` dirs abandoned by earlier runs (crashes, and
   * any predating the withCheckout lifecycle). The uuid shape keeps foreign
   * same-prefix dirs out of scope (adversary M5); the 24h age floor keeps
   * concurrent processes' active checkouts safe. An undeletable entry (foreign
   * owner, locked flags) is skipped, never fatal (adversary H2) — one poisoned
   * dir must not take down every git-source command on the machine.
   */
  private sweepStaleCheckouts(): void {
    if (this.fs.kind(this.tempRoot) !== 'directory') return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const entry of this.fs.readDirectory(this.tempRoot)) {
      if (!SWEEPABLE_CHECKOUT_DIR.test(entry.name)) continue;
      const dir = path.join(this.tempRoot, entry.name);
      const modified = this.fs.modifiedAt(dir);
      if (modified > 0 && modified < cutoff) {
        try {
          this.fs.removeTree(dir);
        } catch {
          /* next run sweeps again once the entry becomes deletable */
        }
      }
    }
  }

  /**
   * Source anchor for update decisions, dispatched on the source kind
   * (ADR-0016): git-like kinds (git/marketplace) anchor on the tree SHA of the
   * skill's own sub-directory, resolved in the checked-out clone — so a
   * checkout and its anchors are captured in one consistent state. A skill
   * anchored at the repo root records the commit SHA, matching what the GitHub
   * Trees API reports for the root (ADR-0013). Every other kind carries no git
   * anchor: local sources never did; url/wellknown anchor on content
   * hash/digest instead; archive is a one-shot snapshot.
   */
  upstreamTree(checkout: SourceCheckout, subpath: string): string | null {
    switch (checkout.kind) {
      case 'local':
      case 'url':
      case 'wellknown':
      case 'archive':
        return null;
      case 'git':
      case 'marketplace':
        return subpath ? this.git.revParseTree(checkout.repoDir, subpath) : checkout.commit;
    }
  }

  discover(source: SourceCheckout): DiscoveredSkill[] {
    if (source.kind === 'marketplace') return this.discoverMarketplace(source);
    const baseDir = source.baseSubpath ? path.join(source.repoDir, source.baseSubpath) : source.repoDir;
    if (this.fs.kind(baseDir) !== 'directory') throw new SkillsManagerError('source_path_missing', `Discovery path does not exist: ${baseDir}`);
    assertPathInside(baseDir, source.repoDir);
    return this.collectSkillsFromTree(baseDir, source, undefined).sort(byDiscoveryOrder);
  }

  /**
   * Two-level marketplace presentation (US-15/17): every plugin in the
   * manifest appears either with its discovered skills (form 1) or with the
   * reason it cannot be consumed (forms 2/3) — nothing vanishes silently.
   * Non-marketplace checkouts have no second level; null.
   */
  marketplaceView(checkout: SourceCheckout, discovered: DiscoveredSkill[]): MarketplaceView | null {
    if (checkout.kind !== 'marketplace') return null;
    return {
      plugins: this.readMarketplaceManifest(checkout).map((plugin) => plugin.form === 'form1'
        ? {
            name: plugin.name,
            skills: discovered
              .filter((skill) => skill.plugin === plugin.name)
              .map((skill) => ({ name: skill.name, subpath: skill.subpath })),
          }
        : { name: plugin.name, skills: [], unsupported: plugin.reason }),
    };
  }

  /** Why a manifest plugin cannot be consumed, or null when the name is not
   *  an unsupported plugin — the control-flow query behind selector
   *  resolution (`marketplaceView` is the presentation shape of the same
   *  parse). */
  unsupportedMarketplacePlugin(checkout: SourceCheckout, name: string): 'git-subdir' | 'url' | 'external-source' | null {
    if (checkout.kind !== 'marketplace') return null;
    const plugin = this.readMarketplaceManifest(checkout).find((entry) => entry.name === name);
    return plugin?.form === 'unsupported' ? plugin.reason : null;
  }

  /**
   * The marketplace discovery flow (source-formats ticket 06): form-1 plugins
   * expand their manifest-declared `skills[]` paths into SKILL.md discovery.
   * The "filter down to consumable plugins" step (US-15) tolerates upstream
   * data errors — a plugin whose source dir or a skill path is missing from
   * the repo drops out, exactly like entries without skills[]; one stale path
   * must not poison the rest of the marketplace. Unsupported forms 2/3 are
   * also skipped here — they surface through `marketplaceView` and fail
   * loudly when named by a selector. Paths come from the untrusted manifest,
   * so containment stays a hard error at every join.
   */
  private discoverMarketplace(source: SourceCheckout): DiscoveredSkill[] {
    const found: DiscoveredSkill[] = [];
    for (const plugin of this.readMarketplaceManifest(source)) {
      if (plugin.form !== 'form1') continue;
      const pluginDir = path.join(source.repoDir, plugin.sourcePath);
      assertPathInside(pluginDir, source.repoDir);
      if (this.fs.kind(pluginDir) !== 'directory') continue;
      for (const skillPath of plugin.skillPaths) {
        const skillDir = path.join(pluginDir, skillPath);
        assertPathInside(skillDir, source.repoDir);
        if (this.fs.kind(skillDir) !== 'directory') continue;
        found.push(...this.collectSkillsFromTree(skillDir, source, plugin.name));
      }
    }
    return found.sort(byDiscoveryOrder);
  }

  private readMarketplaceManifest(checkout: SourceCheckout): ParsedMarketplacePlugin[] {
    return parseMarketplacePlugins(this.fs.readText(path.join(checkout.repoDir, MARKETPLACE_MANIFEST)));
  }

  private collectSkillsFromTree(dir: string, source: SourceCheckout, plugin: string | undefined): DiscoveredSkill[] {
    assertPathInside(dir, source.repoDir);
    const skillFile = path.join(dir, 'SKILL.md');
    if (this.fs.kind(skillFile) === 'file') {
      const metadata = parseSkillMarkdownMetadata(this.fs.readText(skillFile));
      const fallbackName = path.basename(dir);
      const name = String(metadata.name || fallbackName).trim();
      assertSafeSkillName(name);
      return [{
        name,
        title: metadata.title || name,
        description: metadata.description || '',
        subpath: path.relative(source.repoDir, dir).split(path.sep).join('/'),
        absoluteDir: dir,
        ...(plugin !== undefined ? { plugin } : {}),
      }];
    }
    return this.fs.readDirectory(dir)
      .filter((entry) => entry.kind === 'directory' && !this.shouldSkipDiscoverDir(entry.name))
      .flatMap((entry) => this.collectSkillsFromTree(path.join(dir, entry.name), source, plugin));
  }

  assertUniqueSkillDestinations(skills: DiscoveredSkill[]) {
    const byName = new Map<string, string[]>();
    for (const skill of skills) byName.set(skill.name, [...(byName.get(skill.name) || []), skill.subpath]);
    const duplicates = [...byName.entries()].filter(([, subpaths]) => subpaths.length > 1);
    if (duplicates.length > 0) {
      throw new SkillsManagerError('duplicate_skill_names', `Selected skills contain duplicate destination names: ${duplicates.map(([name, subpaths]) => `${name} (${subpaths.join(', ')})`).join('; ')}`);
    }
  }

  private resolveGitHubTreeRef(repoUrl: string, treeRest: string): { ref: string; baseSubpath?: string } {
    const heads = this.git.listRemoteHeads(repoUrl).sort((a, b) => b.length - a.length);
    for (const head of heads) {
      if (treeRest === head) return { ref: head };
      if (treeRest.startsWith(`${head}/`)) return { ref: head, baseSubpath: treeRest.slice(head.length + 1) || undefined };
    }
    const [fallbackRef, ...rest] = treeRest.split('/');
    return { ref: fallbackRef, baseSubpath: rest.join('/') || undefined };
  }

  private shouldSkipDiscoverDir(dirName: string) {
    return ['.git', 'node_modules', 'dist', 'build', '.next', '.turbo'].includes(dirName);
  }
}
