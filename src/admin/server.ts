import fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_HOME } from '../paths.js';
import { loadRegistry, skillExists } from '../registry.js';
import { CONSUMERS, parseConsumers } from '../types.js';
import {
  discoverFromSource,
  expose,
  groupUpdateCandidates,
  hide,
  installFromSourceSelection,
  updateBySkillNames,
  updateCandidatesFromRegistry,
  updateRegistrySkills,
} from '../commands.js';
import { run } from '../run.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

type AdminOptions = {
  port: number;
  host: string;
  open: boolean;
};

function staticRoot() {
  const candidates = [
    path.resolve(dirname, '..', 'admin-web'),
    path.resolve(process.cwd(), 'dist', 'admin-web'),
  ];
  const found = candidates.find((candidate) => existsSync(path.join(candidate, 'index.html')));
  if (!found) throw new Error('找不到后台前端构建产物。请先运行 pnpm build。');
  return found;
}

function skillsState() {
  const registry = loadRegistry();
  const skills = Object.entries(registry.skills || {})
    .filter(([name]) => skillExists(name))
    .map(([name, entry]) => ({
      name,
      ...entry,
      consumers: entry.consumers || [],
      category: entry.category || 'experimental',
      description: entry.description || '',
      source: entry.source || {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const candidates = updateCandidatesFromRegistry();
  const sources = groupUpdateCandidates(candidates);
  return { skillHome: SKILL_HOME, skills, candidates, sources, consumers: CONSUMERS };
}

export async function startAdminServer(options: AdminOptions) {
  const app = fastify({ logger: false });

  app.get('/api/state', async () => skillsState());
  app.get('/api/doctor', async () => ({ ok: true, gitStatus: run('git', ['status', '--short'], { quiet: true }) || 'clean' }));

  app.post('/api/discover', async (request) => {
    const body = request.body as { source?: string };
    const { discovered, sourceInfo } = discoverFromSource(String(body.source || ''));
    return { discovered, sourceInfo: { repoUrl: sourceInfo.repoUrl, ref: sourceInfo.ref, baseSubpath: sourceInfo.baseSubpath, commit: sourceInfo.commit, isLocal: sourceInfo.isLocal } };
  });

  app.post('/api/install-source', async (request) => {
    const body = request.body as { source?: string; subpaths?: string[]; consumers?: string[] };
    const selected = await installFromSourceSelection(String(body.source || ''), body.subpaths || [], parseConsumers(body.consumers || [...CONSUMERS]), { yes: true });
    return { ok: true, installed: selected.map((skill) => skill.name) };
  });

  app.post('/api/update-skills', async (request) => {
    const body = request.body as { skills?: string[] };
    await updateBySkillNames(body.skills || [], { yes: true });
    return { ok: true, updated: body.skills || [] };
  });

  app.post('/api/update-source', async (request) => {
    const body = request.body as { key?: string };
    const group = groupUpdateCandidates(updateCandidatesFromRegistry()).find((item) => item.key === body.key);
    if (!group) throw new Error(`找不到来源：${body.key}`);
    await updateRegistrySkills(group.skills, { yes: true });
    return { ok: true, updated: group.skills.map((skill) => skill.skill) };
  });

  app.post('/api/expose', async (request) => {
    const body = request.body as { skills?: string[]; consumer?: string };
    const consumer = parseConsumers([String(body.consumer)])[0];
    for (const skill of body.skills || []) expose(skill, [consumer]);
    return { ok: true, skills: body.skills || [], consumer };
  });

  app.post('/api/hide', async (request) => {
    const body = request.body as { skills?: string[]; consumer?: string };
    const consumer = parseConsumers([String(body.consumer)])[0];
    for (const skill of body.skills || []) hide(skill, [consumer]);
    return { ok: true, skills: body.skills || [], consumer };
  });

  await app.register(fastifyStatic, { root: staticRoot(), prefix: '/' });
  app.setNotFoundHandler((_request, reply) => reply.sendFile('index.html'));

  await app.listen({ port: options.port, host: options.host });
  const url = `http://${options.host === '0.0.0.0' ? 'localhost' : options.host}:${options.port}`;
  console.log(`Skills Admin 已启动：${url}`);
  if (options.open) openBrowser(url);
}

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  execFile(command, args, () => {});
}
