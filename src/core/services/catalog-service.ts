import os from 'node:os';
import path from 'node:path';
import type { CatalogSnapshot } from '../model/catalog.js';
import type { SkillHome } from '../model/index.js';
import type { FileSystemPort } from '../ports/filesystem.js';
import { SkillsManagerError } from '../../shared/errors.js';
import { detectAgents } from '../catalog/evaluate-detection.js';
import { extractCatalogSnapshot } from '../catalog/extract.js';
import { resolveCatalogTemplate } from '../catalog/resolve-path.js';
import { validateCatalogSnapshot } from '../catalog/validate-snapshot.js';

const RAW_BASE = 'https://raw.githubusercontent.com/vercel-labs/skills/main';
const COMMIT_API = 'https://api.github.com/repos/vercel-labs/skills/commits?path=src/agents.ts&per_page=1';
const BUNDLED_SNAPSHOT_URL = new URL('../catalog/agent-catalog.json', import.meta.url);

export type CatalogServiceOptions = {
  /** Fixture injection for tests; skips all file loading. */
  snapshot?: CatalogSnapshot;
  now?: () => Date;
  /** Environment used for detection evaluation; defaults to process.env. */
  env?: Record<string, string | undefined>;
  userHomeDir?: string;
  /** Overridable downloader so refresh stays testable offline. */
  fetchText?: (url: string) => Promise<string>;
};

export type CatalogSnapshotInfo = {
  source: 'injected' | 'hub' | 'bundled';
  commit: string;
  date: string;
  ageDays: number;
};

async function defaultFetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new SkillsManagerError('catalog_refresh_failed', `Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

export class CatalogService {
  private loaded: CatalogSnapshot | null = null;
  private loadedFrom: CatalogSnapshotInfo['source'] | null = null;

  constructor(
    private readonly fs: FileSystemPort,
    private readonly home: SkillHome,
    private readonly options: CatalogServiceOptions = {},
  ) {}

  /** Effective snapshot: injected fixture > hub refresh override > bundled file. */
  load(): CatalogSnapshot {
    if (this.loaded) return this.loaded;
    if (this.options.snapshot) {
      this.loaded = validateCatalogSnapshot(this.options.snapshot);
      this.loadedFrom = 'injected';
      return this.loaded;
    }
    const overridePath = this.overridePath();
    if (this.fs.kind(overridePath) === 'file') {
      this.loaded = validateCatalogSnapshot(this.parseJson(this.fs.readText(overridePath), overridePath));
      this.loadedFrom = 'hub';
      return this.loaded;
    }
    this.loaded = validateCatalogSnapshot(this.parseJson(this.fs.readText(BUNDLED_SNAPSHOT_URL.pathname), 'bundled snapshot'));
    this.loadedFrom = 'bundled';
    return this.loaded;
  }

  /** The detected agent set on this machine — same rules, same data as `npx skills` with no -a. */
  detected(): string[] {
    const snapshot = this.load();
    const homeDir = this.options.userHomeDir ?? os.homedir();
    const env = this.options.env ?? process.env;
    return detectAgents(snapshot, {
      variables: snapshot.pathVariables,
      env,
      homeDir,
      cwd: process.cwd(),
      pathExists: (absolute) => this.fs.exists(absolute),
      cwdPathExists: (relative) => this.fs.exists(path.resolve(process.cwd(), relative)),
      packageHasDependency: (name) => this.packageJsonInCwdDeclares(name),
      isTty: process.stdout.isTTY === true,
    });
  }

  snapshotInfo(): CatalogSnapshotInfo {
    const snapshot = this.load();
    const now = this.options.now ? this.options.now() : new Date();
    const ageDays = Math.floor((now.getTime() - new Date(snapshot.source.date).getTime()) / (24 * 60 * 60 * 1000));
    return { source: this.loadedFrom ?? 'bundled', commit: snapshot.source.commit, date: snapshot.source.date, ageDays };
  }

  /** Pull upstream and overwrite the hub-local snapshot; doctor age follows on next read. */
  async refresh(): Promise<{ commit: string; date: string; agentCount: number; wroteTo: string }> {
    const fetchText = this.options.fetchText ?? defaultFetchText;
    const [agentsTs, detectAgentTs, commitJson] = await Promise.all([
      fetchText(`${RAW_BASE}/src/agents.ts`),
      fetchText(`${RAW_BASE}/src/detect-agent.ts`),
      fetchText(COMMIT_API),
    ]);
    const [entry] = JSON.parse(commitJson) as Array<{ sha: string; commit: { committer: { date: string } } }>;
    if (!entry) throw new SkillsManagerError('catalog_refresh_failed', 'Upstream commit endpoint returned no entries');
    const snapshot = extractCatalogSnapshot({ agentsTs, detectAgentTs, commit: entry.sha, date: entry.commit.committer.date });
    const wroteTo = this.overridePath();
    this.fs.makeDirectory(path.dirname(wroteTo));
    this.fs.writeText(wroteTo, `${JSON.stringify(snapshot, null, 2)}\n`);
    this.loaded = snapshot;
    this.loadedFrom = 'hub';
    return { commit: entry.sha, date: entry.commit.committer.date, agentCount: snapshot.agents.length, wroteTo };
  }

  overridePath() {
    return path.join(this.home.root, '.skills', 'agent-catalog.json');
  }

  /** Resolve an agent's global runtime dir against this machine's env/user home; null when it cannot resolve here. */
  resolveGlobalDir(agentId: string): string | null {
    const agent = this.load().agents.find((item) => item.id === agentId);
    if (!agent || !agent.globalSkillsDir) return null;
    return resolveCatalogTemplate(agent.globalSkillsDir, {
      variables: this.load().pathVariables,
      homeDir: this.options.userHomeDir ?? os.homedir(),
      env: this.options.env ?? process.env,
    });
  }

  private parseJson(text: string, origin: string): unknown {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new SkillsManagerError('catalog_invalid', `Cannot parse ${origin}: ${(error as Error).message}. Run \`skills-manager catalog refresh\` to rebuild it.`);
    }
  }

  private packageJsonInCwdDeclares(name: string): boolean {
    const file = path.resolve(process.cwd(), 'package.json');
    if (!this.fs.exists(file)) return false;
    try {
      const parsed = JSON.parse(this.fs.readText(file)) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      return Boolean(parsed.dependencies?.[name] || parsed.devDependencies?.[name]);
    } catch {
      return false;
    }
  }
}
