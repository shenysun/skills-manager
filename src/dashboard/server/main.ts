import fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { errorCode, errorMessage, SkillsManagerError } from '../../shared/errors.js';
import { createRuntimeServices } from '../../infra/runtime.js';
import type { RuntimeOptions } from '../../infra/runtime.js';
import { NodeFileSystem } from '../../infra/fs-skill-home.js';
import { previewFileEntries, previewSkillDir, readSkillFile } from './skill-file.js';

const execFileAsync = promisify(execFile);

export type DashboardServerOptions = RuntimeOptions & {
  port: number;
  host: string;
  open: boolean;
  projectRoot?: string;
};

const dirname = path.dirname(fileURLToPath(import.meta.url));

function hasDashboardIndex(candidate: string) {
  return existsSync(path.join(candidate, 'index.html'));
}

function buildDashboardWeb(projectRoot?: string) {
  if (!projectRoot) return;
  const sourceRoot = path.resolve(projectRoot, 'dashboard-web');
  const viteBin = path.resolve(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(path.join(sourceRoot, 'vite.config.ts')) || !existsSync(viteBin)) return;
  console.log('Dashboard build output not found. Building dashboard web assets...');
  execFileSync(process.execPath, [viteBin, 'build', '--config', path.join(sourceRoot, 'vite.config.ts')], { cwd: projectRoot, stdio: 'inherit' });
}

function staticRoot(projectRoot?: string) {
  const candidates = [
    path.resolve(dirname, '..', '..', 'dashboard-web'),
    projectRoot ? path.resolve(projectRoot, 'dist', 'dashboard-web') : '',
    path.resolve(process.cwd(), 'dist', 'dashboard-web'),
  ].filter(Boolean);
  let found = candidates.find((candidate) => hasDashboardIndex(candidate));
  if (!found) {
    buildDashboardWeb(projectRoot);
    found = candidates.find((candidate) => hasDashboardIndex(candidate));
  }
  if (!found) throw new Error('Dashboard build output not found. Run npm run build first.');
  return found;
}

const sourceBody = {
  type: 'object',
  required: ['source'],
  additionalProperties: false,
  properties: { source: { type: 'string', minLength: 1 } },
} as const;

const initBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    resolve: { type: 'object', additionalProperties: { type: 'string' } },
  },
} as const;

const installBody = {
  type: 'object',
  required: ['source', 'subpaths'],
  additionalProperties: false,
  properties: {
    source: { type: 'string', minLength: 1 },
    subpaths: { type: 'array', items: { type: 'string' } },
    consumers: { type: 'array', items: { type: 'string' } },
    overwrite: { type: 'boolean' },
  },
} as const;

const skillsBody = {
  type: 'object',
  required: ['skills'],
  additionalProperties: false,
  properties: { skills: { type: 'array', items: { type: 'string' } } },
} as const;

const distributeBody = {
  type: 'object',
  required: ['to', 'skills'],
  additionalProperties: false,
  properties: {
    to: { type: 'string', enum: ['user', 'project'] },
    projectRoot: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    agents: { type: 'array', items: { type: 'string' } },
    mode: { type: 'string', enum: ['symlink', 'copy'] },
    force: { type: 'boolean' },
  },
} as const;

const undistributeBody = {
  type: 'object',
  required: ['to', 'skills'],
  additionalProperties: false,
  properties: {
    to: { type: 'string', enum: ['user', 'project'] },
    projectRoot: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
    agents: { type: 'array', items: { type: 'string' } },
  },
} as const;

export function createDashboardApp(options: DashboardServerOptions): FastifyInstance {
  const app = fastify({ logger: false });

  app.setErrorHandler((error: any, _request, reply) => {
    const code = errorCode(error);
    const status = error.statusCode && error.statusCode >= 400
      ? error.statusCode
      : code === 'distribute_foreign_exists'
        ? 409
        : 500;
    reply.status(status).send({
      ok: false,
      error: { code, message: errorMessage(error), details: (error as { details?: unknown }).details },
    });
  });

  const getServices = () => createRuntimeServices(options, options.projectRoot || process.cwd());
  const data = <T>(value: T) => ({ ok: true as const, data: value });

  // Update detection for the single page: hasUpdate is a real diff, not plan
  // membership — local sources compare content trees, remote sources compare
  // the registry's upstream commit against the tracked ref's remote head.
  // Membership alone would mark every sourced skill updatable forever.
  const contentFs = new NodeFileSystem();
  const REMOTE_HEAD_TTL_MS = 5 * 60 * 1000;
  const remoteHeads = new Map<string, { sha: string | null; fetchedAt: number }>();

  async function remoteHeadSha(url: string, ref: string | null | undefined): Promise<string | null> {
    const key = `${url}|${ref || ''}`;
    const cached = remoteHeads.get(key);
    if (cached && Date.now() - cached.fetchedAt < REMOTE_HEAD_TTL_MS) return cached.sha;
    let sha: string | null = null;
    try {
      const args = ref ? ['ls-remote', url, ref] : ['ls-remote', url, 'HEAD'];
      const { stdout } = await execFileAsync('git', args, { timeout: 15000 });
      sha = stdout.trim().split('\t')[0] || null;
    } catch {
      sha = null; // offline or unreachable: stay quiet rather than crying wolf
    }
    remoteHeads.set(key, { sha, fetchedAt: Date.now() });
    return sha;
  }

  /** Mirrors DistributeService.fingerprint's tree hashing so equal trees compare equal.
   *  Drift is caught behaviourally: dashboard-state tests require hasUpdate=false
   *  on a fresh install, which only holds while both algorithms agree. */
  function hashTree(root: string): string | null {
    if (contentFs.kind(root) !== 'directory') return null;
    const hash = createHash('sha256');
    const walk = (prefix: string) => {
      const dir = prefix ? path.join(root, prefix) : root;
      for (const entry of contentFs.readDirectory(dir).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = prefix ? path.join(prefix, entry.name) : entry.name;
        const full = path.join(root, relative);
        const kind = contentFs.kind(full);
        hash.update(relative);
        hash.update('\0');
        hash.update(kind);
        hash.update('\0');
        if (kind === 'file') hash.update(contentFs.readText(full));
        else if (kind === 'symlink') hash.update(contentFs.readlink(full));
        if (entry.kind === 'directory') walk(relative);
      }
    };
    walk('');
    return `sha256:${hash.digest('hex')}`;
  }

  async function detectUpdates(
    services: ReturnType<typeof getServices>,
    skills: ReturnType<typeof services.registry.listSkills>,
  ): Promise<Map<string, boolean>> {
    const candidates = new Set(services.update.plan().candidates.map((candidate) => candidate.skill));
    const updatable = new Map<string, boolean>();
    await Promise.all(
      skills.map(async (skill) => {
        const source = skill.source;
        if (!candidates.has(skill.name) || !source.url || !source.subpath) return;
        if (source.type === 'local') {
          const sourceHash = hashTree(path.resolve(source.url, source.subpath));
          if (sourceHash === null) return;
          updatable.set(skill.name, sourceHash !== services.distribute.fingerprint(skill.name));
          return;
        }
        const remote = await remoteHeadSha(source.url, source.ref);
        if (remote === null || !source.upstream_commit) return;
        updatable.set(skill.name, remote !== source.upstream_commit);
      }),
    );
    return updatable;
  }

  // Single-page state (ADR-0005): one row per skill, recent operations, and the
  // update count. distributedAgents is the logical layer of the hub
  // distribution index — observed agent ids, never registry consumers tags
  // (desired defaults; see ADR-0004).
  const state = async () => {
    const services = getServices();
    const listed = services.registry.listSkills({ includeArchived: false });
    const updatable = await detectUpdates(services, listed);
    const index = services.distribute.listIndex();
    const brokenPaths = new Set(services.doctor.check().brokenLinks);
    const skills = listed.map((skill) => {
      const agents = new Set<string>();
      let warning: 'broken-link' | 'outdated-copy' | null = null;
      let hubFingerprint: string | null = null;
      for (const record of index) {
        for (const entry of record.entries) {
          if (entry.skill !== skill.name) continue;
          entry.agents.forEach((id) => agents.add(id));
          if (!warning && brokenPaths.has(entry.runtimePath)) warning = 'broken-link';
          if (!warning && entry.mode === 'copy') {
            hubFingerprint ??= services.distribute.fingerprint(skill.name);
            if (entry.fingerprint !== hubFingerprint) warning = 'outdated-copy';
          }
        }
      }
      return {
        name: skill.name,
        category: skill.category,
        description: skill.description,
        sourceType: skill.source.type || 'local',
        hasUpdate: updatable.get(skill.name) ?? false,
        warning,
        distributedAgents: [...agents].sort(),
      };
    });
    return {
      skills,
      activity: services.activity.list({ limit: 25 }),
      updateCount: skills.filter((skill) => skill.hasUpdate).length,
      // Read-only derivation of the hub index: the project targets the operator
      // has actually distributed to, most recent first — the picker's datalist.
      knownProjects: index
        .filter((record) => record.kind === 'project')
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
        .map((record) => record.targetRoot),
    };
  };

  app.get('/api/state', async () => data(await state()));

  // Skill preview (read-only): one file of one skill, rendered server-side.
  app.get('/api/skill/file', async (request) => {
    const query = request.query as { name?: string; path?: string };
    const { resolution } = getServices();
    return data(await readSkillFile(resolution.root, query.name ?? '', query.path ?? ''));
  });

  // Skill preview (read-only): the skill's full file list for the tree.
  // listSkillFiles' first consumer (spec §API 契约).
  app.get('/api/skill/files', async (request) => {
    const query = request.query as { name?: string };
    const name = query.name ?? '';
    const { resolution, registry } = getServices();
    const skillDir = previewSkillDir(resolution.root, name);
    return data({ files: previewFileEntries(skillDir, registry.listSkillFiles(name)) });
  });

  // Directory browsing for project path picker: list entries in a directory
  // with parent-link semantics. Prevents traversal attacks by restricting to
  // user home and cwd.
  app.get('/api/fs/browse', async (request) => {
    const query = request.query as { path?: string };
    const userHome = options.userHome || process.env.HOME || os.homedir();
    const cwd = process.cwd();
    let targetPath = query.path ? path.resolve(query.path) : userHome;

    // Security: restrict to user home or cwd to prevent traversal outside allowed bounds
    const normalized = path.normalize(targetPath);
    const normalizedHome = path.normalize(userHome);
    const normalizedCwd = path.normalize(cwd);
    const isInHome = normalized === normalizedHome || normalized.startsWith(normalizedHome + path.sep);
    const isInCwd = normalized === normalizedCwd || normalized.startsWith(normalizedCwd + path.sep);
    if (!isInHome && !isInCwd) {
      throw Object.assign(
        new SkillsManagerError('browse_forbidden', `Access denied to ${targetPath}`),
        { statusCode: 403 },
      );
    }

    const fs = new NodeFileSystem();
    if (fs.kind(targetPath) !== 'directory') {
      throw Object.assign(
        new SkillsManagerError('browse_not_directory', `${targetPath} is not a directory`),
        { statusCode: 400 },
      );
    }

    const entries = fs.readDirectory(targetPath)
      .filter((entry) => entry.kind === 'directory')
      .sort((a, b) => a.name.localeCompare(b.name));

    const parent = targetPath !== userHome && targetPath !== '/'
      ? path.dirname(targetPath)
      : null;

    return data({
      path: targetPath,
      parent,
      entries: entries.map((entry) => ({
        name: entry.name,
        path: path.join(targetPath, entry.name),
      })),
    });
  });

  // Picker data endpoint: the full catalog filtered for a scope, with detected
  // flags, family keys for shared-path grouping, and invalid reasons.
  app.get('/api/catalog/agents', async (request) => {
    const query = request.query as { scope?: string; projectRoot?: string };
    const scope = query.scope === 'project' ? 'project' : 'user';
    const services = getServices();
    const snapshot = services.catalog.load();
    const detected = new Set(services.catalog.detected());
    // Project families depend on the named project — same project-required
    // semantics as the distribute service; no silent server-cwd fallback.
    if (scope === 'project' && !query.projectRoot) {
      throw Object.assign(
        new SkillsManagerError('catalog_project_root_required', 'Project scope requires an explicit projectRoot'),
        { statusCode: 400 },
      );
    }
    const projectRoot = path.resolve(query.projectRoot ?? '');
    const agents = snapshot.agents.map((agent) => {
      if (scope === 'user') {
        if (!agent.globalSkillsDir) {
          return { id: agent.id, label: agent.label, detected: detected.has(agent.id), familyKey: null, invalidReason: 'Project-only agent: the catalog has no global runtime path for it. Switch to project scope to use it.' };
        }
        const familyKey = services.catalog.resolveGlobalDir(agent.id);
        return { id: agent.id, label: agent.label, detected: detected.has(agent.id), familyKey, invalidReason: familyKey === null ? 'Global runtime dir cannot be resolved on this machine.' : null };
      }
      return { id: agent.id, label: agent.label, detected: detected.has(agent.id), familyKey: path.join(projectRoot, agent.skillsDir), invalidReason: null };
    });
    return data({ scope, agents });
  });

  app.post('/api/discover', { schema: { body: sourceBody } }, async (request) => {
    const body = request.body as { source: string };
    const services = getServices();
    const source = services.source.checkout(body.source);
    return data({ sourceInfo: source, discovered: services.source.discover(source), existing: services.registry.listCanonicalSkills() });
  });

  // Reverse import (ADR-0006): the dashboard's conflict decisions arrive as the
  // same resolve map the CLI's --resolve flags produce.
  app.post('/api/init/preview', async () => {
    const services = getServices();
    return data(services.init.run({ dryRun: true }));
  });

  app.post('/api/init/apply', { schema: { body: initBody } }, async (request) => {
    const body = request.body as { resolve?: Record<string, string> };
    const services = getServices();
    const result = services.init.run({ resolve: body.resolve });
    services.activity.record({ action: 'init', summary: `Imported ${result.imported.join(', ') || 'nothing'} from runtime dirs`, details: { imported: result.imported, conflicts: result.conflicts.map((conflict) => conflict.skill), failed: result.failed } });
    return data(result);
  });

  app.post('/api/install', { schema: { body: installBody } }, async (request) => {
    const body = request.body as { source: string; subpaths: string[]; consumers?: string[]; overwrite?: boolean };
    const services = getServices();
    const result = services.install.installFromSourceSelection({ source: body.source, selectors: body.subpaths, consumers: body.consumers, overwrite: body.overwrite ?? false });
    services.activity.record({ action: 'install', summary: `Installed ${result.installed.join(', ')}`, details: { source: body.source, installed: result.installed } });
    return data(result);
  });

  app.post('/api/update/skills', { schema: { body: skillsBody } }, async (request) => {
    const body = request.body as { skills: string[] };
    const services = getServices();
    const result = services.update.updateSkills(body.skills);
    services.activity.record({ action: 'update-skills', summary: `Updated ${result.updated.join(', ')}`, details: result });
    return data(result);
  });

  app.post('/api/distribute', { schema: { body: distributeBody } }, async (request) => {
    const body = request.body as { to: 'user' | 'project'; projectRoot?: string; skills: string[]; agents?: string[]; mode?: 'symlink' | 'copy'; force?: boolean };
    const services = getServices();
    const result = services.distribute.apply(body);
    services.activity.record({ action: 'distribute', summary: `Distributed ${body.skills.length} skill(s) to ${body.to}`, details: body });
    return data(result);
  });

  app.post('/api/undistribute', { schema: { body: undistributeBody } }, async (request) => {
    const body = request.body as { to: 'user' | 'project'; projectRoot?: string; skills: string[]; agents?: string[] };
    const services = getServices();
    const result = services.distribute.undistribute(body);
    services.activity.record({ action: 'undistribute', summary: `Undistributed ${body.skills.length} skill(s) from ${body.to}`, details: body });
    return data(result);
  });

  app.post('/api/skills/archive', { schema: { body: skillsBody } }, async (request) => {
    const body = request.body as { skills: string[] };
    const services = getServices();
    const result = services.archive.archiveSkills(body.skills);
    services.activity.record({ action: 'archive', summary: `Archived ${result.archived.join(', ')}`, details: result });
    return data(result);
  });

  // One-step remove (ADR-0005): per skill, undistribute from every known
  // target, then archive. Per-skill results; a failure is reported and never
  // rolls back other skills' successes (same semantics as archive/undistribute).
  app.post('/api/skills/remove', { schema: { body: skillsBody } }, async (request) => {
    const body = request.body as { skills: string[] };
    const services = getServices();
    const results = [];
    for (const skill of body.skills) {
      try {
        let removed = 0;
        for (const record of services.distribute.listIndex()) {
          const entries = record.entries.filter((entry) => entry.skill === skill);
          if (entries.length === 0) continue;
          const out = services.distribute.undistribute({
            to: record.kind,
            projectRoot: record.kind === 'project' ? record.targetRoot : undefined,
            skills: [skill],
            agents: [...new Set(entries.flatMap((entry) => entry.agents))],
          });
          removed += out.removed.length;
        }
        services.archive.archiveSkills([skill]);
        results.push({ skill, ok: true as const, removed });
      } catch (error) {
        results.push({ skill, ok: false as const, error: { code: errorCode(error), message: errorMessage(error) } });
      }
    }
    const done = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    services.activity.record({
      action: 'remove',
      summary: [
        done.length > 0 ? `Removed ${done.map((result) => result.skill).join(', ')}` : null,
        failed.length > 0 ? `failed: ${failed.map((result) => `${result.skill} (${result.error.code})`).join(', ')}` : null,
      ].filter(Boolean).join('; '),
      details: { results },
    });
    return data({ results });
  });

  return app;
}

export async function startDashboardServer(options: DashboardServerOptions) {
  const app = createDashboardApp(options);
  await app.register(fastifyStatic, { root: staticRoot(options.projectRoot), prefix: '/' });
  app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));
  await app.listen({ port: options.port, host: options.host });
  const url = `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${options.port}`;
  console.log(`Skills Manager dashboard: ${url}`);
  if (options.open) openBrowser(url);
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(command, args, () => {});
}
