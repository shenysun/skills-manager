import fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errorCode, errorMessage } from '../../shared/errors.js';
import { createRuntimeServices } from '../../infra/runtime.js';
import type { RuntimeOptions } from '../../infra/runtime.js';

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

  // Single-page state (ADR-0005): one row per skill, recent operations, and the
  // update count. distributedAgents is the logical layer of the hub
  // distribution index — observed agent ids, never registry consumers tags
  // (desired defaults; see ADR-0004).
  const state = () => {
    const services = getServices();
    const candidates = services.update.plan().candidates;
    const updatable = new Set(candidates.map((candidate) => candidate.skill));
    const index = services.distribute.listIndex();
    const brokenPaths = new Set(services.doctor.check().brokenLinks);
    const skills = services.registry.listSkills({ includeArchived: false }).map((skill) => {
      const agents = new Set<string>();
      let warning: string | null = null;
      let hubFingerprint: string | null = null;
      for (const record of index) {
        for (const entry of record.entries) {
          if (entry.skill !== skill.name) continue;
          entry.agents.forEach((id) => agents.add(id));
          if (!warning && brokenPaths.has(entry.runtimePath)) warning = `Broken runtime link: ${entry.runtimePath}`;
          if (!warning && entry.mode === 'copy') {
            hubFingerprint ??= services.distribute.fingerprint(skill.name);
            if (entry.fingerprint !== hubFingerprint) warning = `Outdated copy: ${entry.runtimePath}`;
          }
        }
      }
      return {
        name: skill.name,
        category: skill.category,
        description: skill.description,
        sourceType: skill.source.type || 'local',
        hasUpdate: updatable.has(skill.name),
        warning,
        distributedAgents: [...agents].sort(),
      };
    });
    return {
      skills,
      activity: services.activity.list({ limit: 25 }),
      updateCount: candidates.length,
    };
  };

  app.get('/api/state', async () => data(state()));

  // Picker data endpoint: the full catalog filtered for a scope, with detected
  // flags, family keys for shared-path grouping, and invalid reasons.
  app.get('/api/catalog/agents', async (request) => {
    const query = request.query as { scope?: string; projectRoot?: string };
    const scope = query.scope === 'project' ? 'project' : 'user';
    const services = getServices();
    const snapshot = services.catalog.load();
    const detected = new Set(services.catalog.detected());
    const projectRoot = query.projectRoot ? path.resolve(query.projectRoot) : process.cwd();
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
