import fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { execFile } from 'node:child_process';
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

function staticRoot() {
  const candidates = [
    path.resolve(dirname, '..', '..', 'dashboard-web'),
    path.resolve(process.cwd(), 'dist', 'dashboard-web'),
  ];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'index.html')));
  if (!found) throw new Error('Dashboard build output not found. Run npm run build first.');
  return found;
}

const jsonBody = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

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
    consumers: { type: 'array', items: { type: 'string', enum: ['agents', 'claude'] } },
    overwrite: { type: 'boolean' },
  },
} as const;

const skillsBody = {
  type: 'object',
  required: ['skills'],
  additionalProperties: false,
  properties: { skills: { type: 'array', items: { type: 'string' } } },
} as const;

const consumerBody = {
  type: 'object',
  required: ['skills', 'consumer'],
  additionalProperties: false,
  properties: {
    skills: { type: 'array', items: { type: 'string' } },
    consumer: { type: 'string', enum: ['agents', 'claude'] },
  },
} as const;

const sourceUpdateBody = {
  type: 'object',
  required: ['key'],
  additionalProperties: false,
  properties: {
    key: { type: 'string' },
    skills: { type: 'array', items: { type: 'string' } },
  },
} as const;

const registryEditBody = {
  type: 'object',
  required: ['skill', 'patch'],
  additionalProperties: false,
  properties: {
    skill: { type: 'string' },
    patch: { type: 'object', additionalProperties: true },
  },
} as const;

export function createDashboardApp(options: DashboardServerOptions): FastifyInstance {
  const app = fastify({ logger: false });

  app.setErrorHandler((error: any, _request, reply) => {
    reply.status(error.statusCode && error.statusCode >= 400 ? error.statusCode : 500).send({
      ok: false,
      error: { code: errorCode(error), message: errorMessage(error), details: (error as { details?: unknown }).details },
    });
  });

  const getServices = () => createRuntimeServices(options, options.projectRoot || process.cwd());
  const data = <T>(value: T) => ({ ok: true as const, data: value });

  const state = () => {
    const services = getServices();
    const skills = services.registry.listSkills({ includeArchived: false }).map((skill) => ({ ...skill, files: services.registry.listSkillFiles(skill.name) }));
    const updatePlan = services.update.plan();
    const doctor = services.doctor.check();
    const registry = services.registry.load();
    const sources = updatePlan.groups.map((group) => ({ ...group, installedSkills: group.skills.map((skill) => skill.skill) }));
    return {
      skillHome: services.home.root,
      resolution: services.resolution,
      skills,
      candidates: updatePlan.candidates,
      sources,
      consumers: ['agents', 'claude'],
      doctor,
      registry,
      activity: services.activity.list({ limit: 25 }),
      gitHistory: services.activity.gitHistory({ limit: 25 }),
      package: services.package.check(),
      counts: {
        skills: skills.length,
        sources: sources.length,
        agents: doctor.viewLinks.agents,
        claude: doctor.viewLinks.claude,
      },
    };
  };

  app.get('/api/state', async () => data(state()));
  app.get('/api/skills', async () => data(state().skills));
  app.get('/api/sources', async () => data(state().sources));
  app.get('/api/updates', async () => data(getServices().update.plan()));
  app.get('/api/registry', async () => data(getServices().registry.load()));
  app.get('/api/activity', async () => { const services = getServices(); return data({ records: services.activity.list({ limit: 100 }), git: services.activity.gitHistory({ limit: 100 }) }); });
  app.get('/api/doctor', async () => data(getServices().doctor.check()));
  app.get('/api/package', async () => data(getServices().package.check()));

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

  app.post('/api/update/source', { schema: { body: sourceUpdateBody } }, async (request) => {
    const body = request.body as { key: string; skills?: string[] };
    const services = getServices();
    const result = services.update.updateSource(body.key, body.skills);
    services.activity.record({ action: 'update-source', summary: `Updated source ${body.key}`, details: { ...result, selected: body.skills || null } });
    return data(result);
  });

  app.post('/api/skills/expose', { schema: { body: consumerBody } }, async (request) => {
    const body = request.body as { skills: string[]; consumer: string };
    const services = getServices();
    for (const skill of body.skills) services.views.expose(skill, [body.consumer]);
    services.activity.record({ action: 'expose', summary: `Exposed ${body.skills.length} skill(s) to ${body.consumer}`, details: body });
    return data({ skills: body.skills, consumer: body.consumer });
  });

  app.post('/api/skills/hide', { schema: { body: consumerBody } }, async (request) => {
    const body = request.body as { skills: string[]; consumer: string };
    const services = getServices();
    for (const skill of body.skills) services.views.hide(skill, [body.consumer]);
    services.activity.record({ action: 'hide', summary: `Hid ${body.skills.length} skill(s) from ${body.consumer}`, details: body });
    return data({ skills: body.skills, consumer: body.consumer });
  });

  app.post('/api/registry/edit', { schema: { body: registryEditBody } }, async (request) => {
    const body = request.body as { skill: string; patch: Record<string, unknown> };
    const services = getServices();
    const entry = services.registry.editSafeFields(body.skill, body.patch);
    services.views.rebuildViews();
    services.views.rebuildCollections();
    services.activity.record({ action: 'registry-edit', summary: `Edited registry metadata for ${body.skill}`, details: { skill: body.skill, patch: body.patch } });
    return data(entry);
  });

  app.post('/api/package/dry-run', { schema: { body: jsonBody } }, async () => data(getServices().package.packDryRun()));

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
  await app.register(fastifyStatic, { root: staticRoot(), prefix: '/' });
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
