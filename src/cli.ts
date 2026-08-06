#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import YAML from 'yaml';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync, statSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const DEFAULT_SKILL_HOME = path.join(HOME, 'Documents/Cheese/ai/agent-skills');
const SKILL_HOME = process.env.SKILL_HOME || DEFAULT_SKILL_HOME;

type Consumer = 'agents' | 'claude';
type SkillEntry = {
  path?: string;
  title?: string;
  category?: string;
  tags?: string[];
  consumers?: Consumer[];
  source?: {
    type?: string;
    url?: string | null;
    subpath?: string | null;
    upstream_commit?: string | null;
    imported_from?: string[];
  };
  update_policy?: string;
  description?: string;
  [key: string]: unknown;
};
type Registry = { skills: Record<string, SkillEntry> };

function p(...parts: string[]) {
  return path.join(SKILL_HOME, ...parts);
}

function rel(abs: string) {
  return path.relative(SKILL_HOME, abs) || '.';
}

function assertSkillHome() {
  if (!existsSync(SKILL_HOME)) {
    throw new Error(`SKILL_HOME does not exist: ${SKILL_HOME}`);
  }
}

function run(cmd: string, args: string[], opts: { cwd?: string; quiet?: boolean } = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || SKILL_HOME,
    stdio: opts.quiet ? 'pipe' : 'inherit',
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    const detail = opts.quiet ? `\n${r.stderr || r.stdout || ''}` : '';
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}${detail}`);
  }
  return (r.stdout || '').trim();
}

function registryPath() {
  return p('registry.yaml');
}

function loadRegistry(): Registry {
  assertSkillHome();
  const file = registryPath();
  if (!existsSync(file)) return { skills: {} };
  const parsed = YAML.parse(readFileSync(file, 'utf8')) as Registry | null;
  return parsed && parsed.skills ? parsed : { skills: {} };
}

function saveRegistry(registry: Registry) {
  writeFileSync(registryPath(), YAML.stringify(registry, { lineWidth: 0 }));
}

function skillDir(skill: string) {
  return p('skills', skill);
}

function skillExists(skill: string) {
  return existsSync(path.join(skillDir(skill), 'SKILL.md'));
}

function listCanonicalSkills() {
  const dir = p('skills');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.') && skillExists(name))
    .sort();
}

function safeClearSymlinkDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const child of readdirSync(dir)) {
    const full = path.join(dir, child);
    const st = lstatSync(full);
    if (st.isSymbolicLink() || st.isFile()) {
      unlinkSync(full);
    } else if (st.isDirectory()) {
      throw new Error(`Refusing to remove real directory in view/collection: ${full}. Adopt it first.`);
    }
  }
}

function linkView(consumer: Consumer, skill: string) {
  const dir = p('views', consumer);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, skill);
  if (existsSync(target) || lstatExists(target)) {
    const st = lstatSync(target);
    if (!st.isSymbolicLink() && !st.isFile()) {
      throw new Error(`Refusing to replace real directory: ${target}`);
    }
    unlinkSync(target);
  }
  symlinkSync(path.join('..', '..', 'skills', skill), target);
}

function lstatExists(file: string) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function rebuildViews() {
  const registry = loadRegistry();
  safeClearSymlinkDir(p('views', 'agents'));
  safeClearSymlinkDir(p('views', 'claude'));
  for (const [skill, entry] of Object.entries(registry.skills || {})) {
    if (!skillExists(skill)) continue;
    for (const consumer of entry.consumers || []) {
      if (consumer === 'agents' || consumer === 'claude') linkView(consumer, skill);
    }
  }
}

function rebuildCollections() {
  const registry = loadRegistry();
  const root = p('collections');
  mkdirSync(root, { recursive: true });
  for (const item of readdirSync(root)) {
    const full = path.join(root, item);
    const st = lstatSync(full);
    if (st.isSymbolicLink() || st.isFile()) {
      unlinkSync(full);
    } else if (st.isDirectory()) {
      for (const child of readdirSync(full)) {
        const c = path.join(full, child);
        const cst = lstatSync(c);
        if (cst.isSymbolicLink() || cst.isFile()) unlinkSync(c);
        else throw new Error(`Refusing to remove real directory in collection: ${c}`);
      }
    }
  }
  for (const [skill, entry] of Object.entries(registry.skills || {})) {
    if (!skillExists(skill)) continue;
    const category = entry.category || 'experimental';
    const dir = p('collections', category);
    mkdirSync(dir, { recursive: true });
    const link = path.join(dir, skill);
    if (!lstatExists(link)) symlinkSync(path.join('..', '..', 'skills', skill), link);
  }
}

function ensureRegistryEntry(skill: string, patch: Partial<SkillEntry> = {}) {
  const registry = loadRegistry();
  registry.skills ||= {};
  registry.skills[skill] = {
    path: `skills/${skill}`,
    title: skill,
    category: 'experimental',
    tags: [],
    consumers: ['agents', 'claude'],
    source: { type: 'local', url: null, subpath: null, upstream_commit: null },
    update_policy: 'manual',
    description: '',
    ...(registry.skills[skill] || {}),
    ...patch,
  };
  saveRegistry(registry);
}

function getLivePath(consumer: Consumer) {
  return consumer === 'agents' ? path.join(HOME, '.agents', 'skills') : path.join(HOME, '.claude', 'skills');
}

function countLinks(dir: string) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((x) => lstatSync(path.join(dir, x)).isSymbolicLink()).length;
}

function doctor() {
  assertSkillHome();
  const skills = listCanonicalSkills();
  const broken: string[] = [];
  for (const base of [p('views'), p('collections')]) {
    if (!existsSync(base)) continue;
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = lstatSync(full);
        if (st.isDirectory() && !st.isSymbolicLink()) walk(full);
        if (st.isSymbolicLink()) {
          try { statSync(full); } catch { broken.push(full); }
        }
      }
    };
    walk(base);
  }
  console.log(`Skill home: ${SKILL_HOME}`);
  console.log(`Canonical skills: ${skills.length}`);
  console.log(`Agent view links: ${countLinks(p('views', 'agents'))}`);
  console.log(`Claude view links: ${countLinks(p('views', 'claude'))}`);
  console.log(`Broken symlinks: ${broken.length}`);
  for (const b of broken) console.log(`  ${rel(b)}`);
  for (const consumer of ['agents', 'claude'] as Consumer[]) {
    const live = getLivePath(consumer);
    if (lstatExists(live) && lstatSync(live).isSymbolicLink()) {
      console.log(`${consumer} live: symlink -> ${readlinkSafe(live)}`);
    } else if (existsSync(live)) {
      console.log(`${consumer} live: NOT YET SWITCHED, real directory at ${live}`);
    } else {
      console.log(`${consumer} live: missing at ${live}`);
    }
  }
  const status = run('git', ['status', '--short'], { quiet: true });
  console.log(status ? `Git status:\n${status}` : 'Git status: clean');
}

function readlinkSafe(file: string) {
  try { return os.platform() === 'win32' ? file : readlinkSync(file); } catch { return '?'; }
}

async function confirm(message: string, yes?: boolean) {
  if (yes) return true;
  const ans = await inquirer.prompt([{ type: 'confirm', name: 'ok', message, default: false }]);
  return Boolean(ans.ok);
}

function timestamp() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function switchLive(opts: { yes?: boolean; dryRun?: boolean }) {
  const ts = timestamp();
  const actions = [
    `mv ~/.agents/skills ~/.agents/skills.backup-${ts}`,
    `mv ~/.claude/skills ~/.claude/skills.backup-${ts}`,
    `ln -s ${p('views', 'agents')} ~/.agents/skills`,
    `ln -s ${p('views', 'claude')} ~/.claude/skills`,
  ];
  console.log(actions.join('\n'));
  if (opts.dryRun) return;
  if (!(await confirm('Proceed with live switch?', opts.yes))) return;
  for (const consumer of ['agents', 'claude'] as Consumer[]) {
    const live = getLivePath(consumer);
    if (lstatExists(live)) {
      const st = lstatSync(live);
      if (st.isSymbolicLink()) {
        console.log(`${consumer} is already a symlink; skipping backup.`);
        unlinkSync(live);
      } else {
        renameSync(live, `${live}.backup-${ts}`);
      }
    }
    symlinkSync(p('views', consumer), live);
  }
  doctor();
}

async function rollbackLive(tsArg?: string, opts: { yes?: boolean } = {}) {
  const agentsDir = path.join(HOME, '.agents');
  const backups = existsSync(agentsDir)
    ? readdirSync(agentsDir).map((x) => x.match(/^skills\.backup-(.+)$/)?.[1]).filter(Boolean) as string[]
    : [];
  const ts = tsArg || (await inquirer.prompt([{ type: 'list', name: 'ts', message: 'Choose backup timestamp', choices: backups.sort().reverse() }])).ts;
  if (!ts) throw new Error('No backup timestamp provided');
  if (!(await confirm(`Rollback live skills to backup ${ts}?`, opts.yes))) return;
  for (const consumer of ['agents', 'claude'] as Consumer[]) {
    const live = getLivePath(consumer);
    const backup = `${live}.backup-${ts}`;
    if (!existsSync(backup)) throw new Error(`Backup missing: ${backup}`);
    if (lstatExists(live)) {
      const st = lstatSync(live);
      if (!st.isSymbolicLink()) throw new Error(`Refusing to replace non-symlink live path: ${live}`);
      unlinkSync(live);
    }
    renameSync(backup, live);
  }
  doctor();
}

function listCommand(opts: { consumer?: Consumer; category?: string }) {
  const registry = loadRegistry();
  const rows = Object.entries(registry.skills || {})
    .filter(([skill, entry]) => skillExists(skill) && (!opts.consumer || (entry.consumers || []).includes(opts.consumer)) && (!opts.category || entry.category === opts.category))
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [skill, entry] of rows) {
    const consumers = (entry.consumers || []).join(',') || '-';
    console.log(`${skill}\t${entry.category || 'experimental'}\t${consumers}`);
  }
}

function setConsumers(skill: string, consumers: Consumer[]) {
  if (!skillExists(skill)) throw new Error(`Skill not found: ${skill}`);
  const registry = loadRegistry();
  if (!registry.skills[skill]) ensureRegistryEntry(skill);
  const fresh = loadRegistry();
  fresh.skills[skill].consumers = [...new Set(consumers)].sort() as Consumer[];
  saveRegistry(fresh);
  rebuildViews();
}

function expose(skill: string, consumers: Consumer[]) {
  const registry = loadRegistry();
  const current = registry.skills[skill]?.consumers || [];
  setConsumers(skill, [...current, ...consumers]);
}

function hide(skill: string, consumers: Consumer[]) {
  const registry = loadRegistry();
  const current = registry.skills[skill]?.consumers || [];
  setConsumers(skill, current.filter((c) => !consumers.includes(c)));
}

function installGit(skill: string, repo: string, subpath: string, consumers: Consumer[]) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'skillctl-'));
  run('git', ['clone', repo, path.join(tmp, 'repo')], { cwd: tmp });
  const commit = run('git', ['-C', path.join(tmp, 'repo'), 'rev-parse', 'HEAD'], { quiet: true });
  mkdirSync(skillDir(skill), { recursive: true });
  run('rsync', ['-a', '--delete', `${path.join(tmp, 'repo', subpath)}/`, `${skillDir(skill)}/`]);
  ensureRegistryEntry(skill, {
    consumers,
    source: { type: 'github', url: repo, subpath, upstream_commit: commit },
  });
  rebuildViews();
  rebuildCollections();
  console.log(`Installed ${skill} from ${repo} at ${commit}`);
}

function updateGit(skill: string, repo?: string, subpath?: string) {
  const registry = loadRegistry();
  const entry = registry.skills[skill];
  if (!entry) throw new Error(`No registry entry for ${skill}`);
  const finalRepo = repo || entry.source?.url;
  const finalSubpath = subpath || entry.source?.subpath;
  if (!finalRepo || !finalSubpath) throw new Error(`Missing repo/subpath for ${skill}`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'skillctl-'));
  run('git', ['clone', finalRepo, path.join(tmp, 'repo')], { cwd: tmp });
  const commit = run('git', ['-C', path.join(tmp, 'repo'), 'rev-parse', 'HEAD'], { quiet: true });
  run('rsync', ['-a', '--delete', `${path.join(tmp, 'repo', finalSubpath)}/`, `${skillDir(skill)}/`]);
  entry.source = { ...(entry.source || {}), type: 'github', url: finalRepo, subpath: finalSubpath, upstream_commit: commit };
  saveRegistry(registry);
  console.log(`Updated ${skill} from ${finalRepo} at ${commit}`);
}

function adopt(view: Consumer, skill: string, also: Consumer[]) {
  const src = p('views', view, skill);
  const dst = skillDir(skill);
  if (!existsSync(src) || lstatSync(src).isSymbolicLink()) throw new Error(`${src} must be a real directory installed into a view`);
  if (existsSync(dst)) throw new Error(`Canonical skill already exists: ${dst}`);
  renameSync(src, dst);
  const consumers = [...new Set([view, ...also])] as Consumer[];
  ensureRegistryEntry(skill, { consumers, source: { type: 'local', url: null, subpath: null, upstream_commit: null } });
  rebuildViews();
  rebuildCollections();
  console.log(`Adopted ${skill} into ${dst}`);
}

async function menu() {
  assertSkillHome();
  const choices = [
    'doctor', 'list', 'rebuild views', 'rebuild collections', 'switch live', 'rollback live',
    'expose skill', 'hide skill', 'install from git', 'update from git', 'git status', 'quit'
  ];
  while (true) {
    const { action } = await inquirer.prompt([{ type: 'list', name: 'action', message: 'skillctl', choices }]);
    try {
      if (action === 'quit') return;
      if (action === 'doctor') doctor();
      if (action === 'list') listCommand({});
      if (action === 'rebuild views') { rebuildViews(); console.log('Views rebuilt'); }
      if (action === 'rebuild collections') { rebuildCollections(); console.log('Collections rebuilt'); }
      if (action === 'switch live') await switchLive({});
      if (action === 'rollback live') await rollbackLive(undefined, {});
      if (action === 'git status') run('git', ['status']);
      if (action === 'expose skill' || action === 'hide skill') {
        const skills = listCanonicalSkills();
        const ans = await inquirer.prompt([
          { type: 'list', name: 'skill', message: 'Skill', choices: skills },
          { type: 'checkbox', name: 'consumers', message: 'Consumers', choices: ['agents', 'claude'], validate: (x) => x.length > 0 || 'Choose at least one' },
        ]);
        if (action === 'expose skill') expose(ans.skill, ans.consumers);
        else hide(ans.skill, ans.consumers);
      }
      if (action === 'install from git') {
        const ans = await inquirer.prompt([
          { type: 'input', name: 'skill', message: 'Skill name' },
          { type: 'input', name: 'repo', message: 'Git URL' },
          { type: 'input', name: 'subpath', message: 'Subpath in repo', default: (a) => `skills/${a.skill}` },
          { type: 'checkbox', name: 'consumers', message: 'Consumers', choices: ['agents', 'claude'], default: ['agents', 'claude'] },
        ]);
        installGit(ans.skill, ans.repo, ans.subpath, ans.consumers);
      }
      if (action === 'update from git') {
        const skills = listCanonicalSkills();
        const ans = await inquirer.prompt([{ type: 'list', name: 'skill', message: 'Skill', choices: skills }]);
        updateGit(ans.skill);
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
  }
}

const program = new Command();
program.name('skillctl').description('Manage central agent/Claude skills').version('0.1.0');

program.command('menu').description('Open interactive menu').action(menu);
program.command('doctor').description('Run health check').action(() => doctor());
program.command('list').description('List skills').option('-c, --consumer <consumer>', 'agents|claude').option('--category <category>').action((opts) => listCommand(opts));
program.command('rebuild-views').description('Rebuild views from registry').action(() => { rebuildViews(); console.log('Views rebuilt'); });
program.command('rebuild-collections').description('Rebuild collections from registry').action(() => { rebuildCollections(); console.log('Collections rebuilt'); });
program.command('switch').description('Switch ~/.agents/skills and ~/.claude/skills to central views').option('-y, --yes').option('--dry-run').action((opts) => switchLive(opts));
program.command('rollback').description('Rollback live entry points to backup timestamp').argument('[timestamp]').option('-y, --yes').action((ts, opts) => rollbackLive(ts, opts));
program.command('expose').description('Expose skill to consumers').argument('<skill>').argument('<consumers...>').action((skill, consumers) => expose(skill, consumers));
program.command('hide').description('Hide skill from consumers').argument('<skill>').argument('<consumers...>').action((skill, consumers) => hide(skill, consumers));
program.command('install-git').description('Install skill from git repo').argument('<skill>').argument('<repo>').argument('<subpath>').argument('[consumers...]').action((skill, repo, subpath, consumers) => installGit(skill, repo, subpath, consumers?.length ? consumers : ['agents', 'claude']));
program.command('update-git').description('Update skill from git repo; defaults to registry source').argument('<skill>').argument('[repo]').argument('[subpath]').action(updateGit);
program.command('adopt').description('Adopt real directory installed into a view').argument('<view>').argument('<skill>').argument('[alsoConsumers...]').action(adopt);

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
