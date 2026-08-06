#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import YAML from 'yaml';
import { table } from 'table';
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

type DiscoveredSkill = {
  name: string;
  title: string;
  description: string;
  subpath: string;
  absoluteDir: string;
};

type SourceInfo = {
  repoUrl: string;
  repoDir: string;
  baseSubpath?: string;
  commit: string | null;
  isLocal: boolean;
};

function p(...parts: string[]) {
  return path.join(SKILL_HOME, ...parts);
}

function rel(abs: string) {
  return path.relative(SKILL_HOME, abs) || '.';
}

function assertSkillHome() {
  if (!existsSync(SKILL_HOME)) {
    throw new Error(`SKILL_HOME 不存在：${SKILL_HOME}`);
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
    throw new Error(`命令执行失败：${cmd} ${args.join(' ')}${detail}`);
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
      throw new Error(`拒绝删除 view/collection 中的真实目录：${full}。请先执行 adopt 收编。`);
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
      throw new Error(`拒绝替换真实目录：${target}`);
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
        else throw new Error(`拒绝删除 collection 中的真实目录：${c}`);
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
  console.log(`Skill 根目录：${SKILL_HOME}`);
  console.log(`Canonical skills 数量：${skills.length}`);
  console.log(`Agents view 链接数：${countLinks(p('views', 'agents'))}`);
  console.log(`Claude view 链接数：${countLinks(p('views', 'claude'))}`);
  console.log(`损坏软链接数：${broken.length}`);
  for (const b of broken) console.log(`  ${rel(b)}`);
  for (const consumer of ['agents', 'claude'] as Consumer[]) {
    const live = getLivePath(consumer);
    if (lstatExists(live) && lstatSync(live).isSymbolicLink()) {
      console.log(`${consumer} 线上入口：软链接 -> ${readlinkSafe(live)}`);
    } else if (existsSync(live)) {
      console.log(`${consumer} 线上入口：尚未切换，当前仍是真实目录 ${live}`);
    } else {
      console.log(`${consumer} 线上入口：缺失 ${live}`);
    }
  }
  const status = run('git', ['status', '--short'], { quiet: true });
  console.log(status ? `Git 状态：\n${status}` : 'Git 状态：干净');
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
  if (!(await confirm('确认切换线上入口吗？', opts.yes))) return;
  for (const consumer of ['agents', 'claude'] as Consumer[]) {
    const live = getLivePath(consumer);
    if (lstatExists(live)) {
      const st = lstatSync(live);
      if (st.isSymbolicLink()) {
        console.log(`${consumer} 已经是软链接，跳过备份。`);
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
  const ts = tsArg || (await inquirer.prompt([{ type: 'select', name: 'ts', message: '选择要回滚的备份时间戳', choices: backups.sort().reverse() }])).ts;
  if (!ts) throw new Error('未提供备份时间戳');
  if (!(await confirm(`确认将线上 skills 回滚到备份 ${ts} 吗？`, opts.yes))) return;
  for (const consumer of ['agents', 'claude'] as Consumer[]) {
    const live = getLivePath(consumer);
    const backup = `${live}.backup-${ts}`;
    if (!existsSync(backup)) throw new Error(`找不到备份：${backup}`);
    if (lstatExists(live)) {
      const st = lstatSync(live);
      if (!st.isSymbolicLink()) throw new Error(`拒绝替换非软链接的线上入口：${live}`);
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

  const data = [
    ['Skill', '分类', '消费者'],
    ...rows.map(([skill, entry]) => [
      skill,
      entry.category || 'experimental',
      (entry.consumers || []).join(', ') || '-',
    ]),
  ];

  console.log(table(data, {
    columns: {
      0: { alignment: 'left' },
      1: { alignment: 'left' },
      2: { alignment: 'left' },
    },
    drawHorizontalLine: (lineIndex, rowCount) => lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
  }).trimEnd());
}

function setConsumers(skill: string, consumers: Consumer[]) {
  if (!skillExists(skill)) throw new Error(`找不到 skill：${skill}`);
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


function parseSkillFrontmatter(file: string): { name?: string; description?: string } {
  const text = readFileSync(file, 'utf8');
  const match = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return {};
  const parsed = YAML.parse(match[1]) as { name?: string; description?: string } | null;
  return parsed || {};
}

function normalizeSource(source: string): { repoUrl: string; baseSubpath?: string; isLocal: boolean } {
  if (existsSync(source)) {
    return { repoUrl: path.resolve(source), isLocal: true };
  }

  // GitHub shorthand: owner/repo
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
    return { repoUrl: `https://github.com/${source}.git`, isLocal: false };
  }

  // GitHub tree URL: https://github.com/owner/repo/tree/branch/path/to/skills
  const githubTree = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/?(.*)$/);
  if (githubTree) {
    const [, owner, repo, _branch, rest] = githubTree;
    return { repoUrl: `https://github.com/${owner}/${repo}.git`, baseSubpath: rest || undefined, isLocal: false };
  }

  // GitHub repo URL without .git
  const githubRepo = source.match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+)\/?$/);
  if (githubRepo) {
    const [, owner, repo] = githubRepo;
    return { repoUrl: `https://github.com/${owner}/${repo.replace(/\.git$/, '')}.git`, isLocal: false };
  }

  return { repoUrl: source, isLocal: false };
}

function checkoutSource(source: string): SourceInfo {
  const normalized = normalizeSource(source);
  if (normalized.isLocal) {
    const commit = existsSync(path.join(normalized.repoUrl, '.git'))
      ? run('git', ['-C', normalized.repoUrl, 'rev-parse', 'HEAD'], { quiet: true })
      : null;
    return { ...normalized, repoDir: normalized.repoUrl, commit };
  }

  const tmp = mkdtempSync(path.join(os.tmpdir(), 'skillctl-source-'));
  const repoDir = path.join(tmp, 'repo');
  run('git', ['clone', normalized.repoUrl, repoDir], { cwd: tmp });
  const commit = run('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { quiet: true });
  return { ...normalized, repoDir, commit };
}

function shouldSkipDiscoverDir(dirName: string) {
  return ['.git', 'node_modules', 'dist', 'build', '.next', '.turbo'].includes(dirName);
}

function discoverSkills(source: SourceInfo): DiscoveredSkill[] {
  const baseDir = source.baseSubpath ? path.join(source.repoDir, source.baseSubpath) : source.repoDir;
  if (!existsSync(baseDir)) throw new Error(`发现路径不存在：${baseDir}`);
  const found: DiscoveredSkill[] = [];
  const walk = (dir: string) => {
    const skillFile = path.join(dir, 'SKILL.md');
    if (existsSync(skillFile)) {
      const fm = parseSkillFrontmatter(skillFile);
      const fallbackName = path.basename(dir);
      const name = String(fm.name || fallbackName).trim();
      found.push({
        name,
        title: name,
        description: String(fm.description || '').trim(),
        subpath: path.relative(source.repoDir, dir).split(path.sep).join('/'),
        absoluteDir: dir,
      });
      return;
    }
    for (const item of readdirSync(dir)) {
      if (shouldSkipDiscoverDir(item)) continue;
      const full = path.join(dir, item);
      if (lstatSync(full).isDirectory()) walk(full);
    }
  };
  walk(baseDir);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function printDiscoveredSkills(skills: DiscoveredSkill[]) {
  const data = [
    ['Skill', '路径', 'Description'],
    ...skills.map((skill) => [skill.name, skill.subpath, skill.description || '-']),
  ];
  console.log(table(data, {
    columns: {
      0: { alignment: 'left' },
      1: { alignment: 'left' },
      2: { alignment: 'left', width: 72, wrapWord: true },
    },
    drawHorizontalLine: (lineIndex, rowCount) => lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
  }).trimEnd());
}

async function addFromSource(source: string, opts: { list?: boolean; all?: boolean; skill?: string[]; consumer?: Consumer[]; yes?: boolean }) {
  const sourceInfo = checkoutSource(source);
  const discovered = discoverSkills(sourceInfo);
  if (discovered.length === 0) throw new Error('没有在该来源中发现 SKILL.md');

  if (opts.list) {
    printDiscoveredSkills(discovered);
    return;
  }

  let selected: DiscoveredSkill[];
  if (opts.all) {
    selected = discovered;
  } else if (opts.skill && opts.skill.length > 0) {
    const requested = new Set(opts.skill);
    selected = discovered.filter((skill) => requested.has(skill.name) || requested.has(skill.subpath));
    const missing = [...requested].filter((name) => !selected.some((skill) => skill.name === name || skill.subpath === name));
    if (missing.length > 0) throw new Error(`未找到指定 skill：${missing.join(', ')}`);
  } else {
    const ans = await inquirer.prompt([{
      type: 'checkbox',
      name: 'skills',
      message: '选择要安装的 skills',
      choices: discovered.map((skill) => ({
        name: `${skill.name}  (${skill.subpath})${skill.description ? ` - ${skill.description}` : ''}`,
        value: skill.name,
      })),
      validate: (value) => value.length > 0 || '至少选择一个 skill',
    }]);
    const selectedNames = new Set(ans.skills as string[]);
    selected = discovered.filter((skill) => selectedNames.has(skill.name));
  }

  let consumers = opts.consumer && opts.consumer.length > 0 ? opts.consumer : undefined;
  if (!consumers) {
    const ans = await inquirer.prompt([{
      type: 'checkbox',
      name: 'consumers',
      message: '选择消费者',
      choices: ['agents', 'claude'],
      default: ['agents', 'claude'],
      validate: (value) => value.length > 0 || '至少选择一个消费者',
    }]);
    consumers = ans.consumers;
  }

  const existing = selected.filter((skill) => existsSync(skillDir(skill.name)));
  if (existing.length > 0 && !(await confirm(`以下 skill 已存在，将覆盖更新：${existing.map((skill) => skill.name).join(', ')}。继续吗？`, opts.yes))) {
    return;
  }

  for (const skill of selected) {
    mkdirSync(skillDir(skill.name), { recursive: true });
    run('rsync', ['-a', '--delete', `${skill.absoluteDir}/`, `${skillDir(skill.name)}/`]);
    ensureRegistryEntry(skill.name, {
      title: skill.title,
      consumers,
      source: {
        type: sourceInfo.isLocal ? 'local' : 'git',
        url: sourceInfo.repoUrl,
        subpath: skill.subpath,
        upstream_commit: sourceInfo.commit,
      },
      description: skill.description,
    });
  }

  rebuildViews();
  rebuildCollections();
  printDiscoveredSkills(selected);
  console.log(`已安装 ${selected.length} 个 skill。下一步建议运行：skillctl doctor && git diff`);
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
  console.log(`已安装 ${skill}；来源：${repo}；版本：${commit}`);
}

function updateGit(skill: string, repo?: string, subpath?: string) {
  const registry = loadRegistry();
  const entry = registry.skills[skill];
  if (!entry) throw new Error(`registry.yaml 中找不到条目：${skill}`);
  const finalRepo = repo || entry.source?.url;
  const finalSubpath = subpath || entry.source?.subpath;
  if (!finalRepo || !finalSubpath) throw new Error(`缺少 repo/subpath：${skill}`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'skillctl-'));
  run('git', ['clone', finalRepo, path.join(tmp, 'repo')], { cwd: tmp });
  const commit = run('git', ['-C', path.join(tmp, 'repo'), 'rev-parse', 'HEAD'], { quiet: true });
  run('rsync', ['-a', '--delete', `${path.join(tmp, 'repo', finalSubpath)}/`, `${skillDir(skill)}/`]);
  entry.source = { ...(entry.source || {}), type: 'github', url: finalRepo, subpath: finalSubpath, upstream_commit: commit };
  saveRegistry(registry);
  console.log(`已更新 ${skill}；来源：${finalRepo}；版本：${commit}`);
}

function adopt(view: Consumer, skill: string, also: Consumer[]) {
  const src = p('views', view, skill);
  const dst = skillDir(skill);
  if (!existsSync(src) || lstatSync(src).isSymbolicLink()) throw new Error(`${src} 必须是安装在 view 中的真实目录`);
  if (existsSync(dst)) throw new Error(`canonical skill 已存在：${dst}`);
  renameSync(src, dst);
  const consumers = [...new Set([view, ...also])] as Consumer[];
  ensureRegistryEntry(skill, { consumers, source: { type: 'local', url: null, subpath: null, upstream_commit: null } });
  rebuildViews();
  rebuildCollections();
  console.log(`已收编 ${skill} 到 ${dst}`);
}

async function menu() {
  assertSkillHome();
  const choices = [
    { name: '健康检查', value: 'doctor' },
    { name: '列出 skills', value: 'list' },
    { name: '重建 views', value: 'rebuild views' },
    { name: '重建 collections', value: 'rebuild collections' },
    { name: '正式切换入口', value: 'switch live' },
    { name: '回滚入口', value: 'rollback live' },
    { name: '暴露 skill 给消费者', value: 'expose skill' },
    { name: '隐藏 skill', value: 'hide skill' },
    { name: '从 URL/Git 发现并安装 skill', value: 'add from source' },
    { name: '从 Git 安装 skill（旧方式）', value: 'install from git' },
    { name: '从 Git 更新 skill', value: 'update from git' },
    { name: '查看 Git 状态', value: 'git status' },
    { name: '退出', value: 'quit' },
  ];
  while (true) {
    const { action } = await inquirer.prompt([{ type: 'select', name: 'action', message: '请选择操作', choices }]);
    try {
      if (action === 'quit') return;
      if (action === 'doctor') doctor();
      if (action === 'list') listCommand({});
      if (action === 'rebuild views') { rebuildViews(); console.log('views 已重建'); }
      if (action === 'rebuild collections') { rebuildCollections(); console.log('collections 已重建'); }
      if (action === 'switch live') await switchLive({});
      if (action === 'rollback live') await rollbackLive(undefined, {});
      if (action === 'git status') run('git', ['status']);
      if (action === 'expose skill' || action === 'hide skill') {
        const skills = listCanonicalSkills();
        const ans = await inquirer.prompt([
          { type: 'select', name: 'skill', message: '选择 skill', choices: skills },
          { type: 'checkbox', name: 'consumers', message: '选择消费者', choices: ['agents', 'claude'], validate: (x) => x.length > 0 || '至少选择一个消费者' },
        ]);
        if (action === 'expose skill') expose(ans.skill, ans.consumers);
        else hide(ans.skill, ans.consumers);
      }
      if (action === 'add from source') {
        const ans = await inquirer.prompt([
          { type: 'input', name: 'source', message: '输入 Git URL、GitHub owner/repo 或本地路径' },
        ]);
        await addFromSource(ans.source, {});
      }
      if (action === 'install from git') {
        const ans = await inquirer.prompt([
          { type: 'input', name: 'skill', message: 'Skill 名称' },
          { type: 'input', name: 'repo', message: 'Git 仓库 URL' },
          { type: 'input', name: 'subpath', message: '仓库内子路径', default: (a) => `skills/${a.skill}` },
          { type: 'checkbox', name: 'consumers', message: '选择消费者', choices: ['agents', 'claude'], default: ['agents', 'claude'] },
        ]);
        installGit(ans.skill, ans.repo, ans.subpath, ans.consumers);
      }
      if (action === 'update from git') {
        const skills = listCanonicalSkills();
        const ans = await inquirer.prompt([{ type: 'select', name: 'skill', message: '选择 skill', choices: skills }]);
        updateGit(ans.skill);
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
  }
}

const program = new Command();
program.name('skillctl').description('统一管理 agents/Claude skills 的中央仓库').version('0.1.0', '-V, --version', '显示版本号').helpOption('-h, --help', '显示帮助').addHelpCommand('help [command]', '显示命令帮助');

program.command('menu').description('打开交互式菜单').action(menu);
program.command('doctor').description('运行健康检查').action(() => doctor());
program.command('list').description('列出 skills').option('-c, --consumer <consumer>', '只显示指定消费者：agents 或 claude').option('--category <category>', '只显示指定分类').action((opts) => listCommand(opts));
program.command('rebuild-views').description('根据 registry.yaml 重建 views').action(() => { rebuildViews(); console.log('views 已重建'); });
program.command('rebuild-collections').description('根据 registry.yaml 重建 collections').action(() => { rebuildCollections(); console.log('collections 已重建'); });
program.command('switch').description('将 ~/.agents/skills 和 ~/.claude/skills 切换到中央仓库 views').option('-y, --yes', '跳过确认提示').option('--dry-run', '只预览，不执行').action((opts) => switchLive(opts));
program.command('rollback').description('按备份时间戳回滚线上入口').argument('[timestamp]', '备份时间戳，例如 20260806-112050').option('-y, --yes', '跳过确认提示').action((ts, opts) => rollbackLive(ts, opts));
program.command('expose').description('把 skill 暴露给指定消费者').argument('<skill>', 'skill 名称').argument('<consumers...>', '消费者列表：agents claude').action((skill, consumers) => expose(skill, consumers));
program.command('hide').description('从指定消费者隐藏 skill').argument('<skill>', 'skill 名称').argument('<consumers...>', '消费者列表：agents claude').action((skill, consumers) => hide(skill, consumers));
program.command('add').description('先提供 URL/GitHub 仓库/本地路径，再发现并选择要安装的 skills').argument('<source>', 'Git URL、GitHub owner/repo、GitHub tree URL 或本地路径').option('--list', '只列出可安装 skills，不安装').option('--all', '安装发现到的全部 skills').option('-s, --skill <skill...>', '只安装指定 skill 名称或路径').option('-c, --consumer <consumer...>', '消费者列表：agents claude').option('-y, --yes', '覆盖已有 skill 时跳过确认').action((source, opts) => addFromSource(source, opts));
program.command('install-git').description('从 Git 仓库安装 skill').argument('<skill>', 'skill 名称').argument('<repo>', 'Git 仓库 URL').argument('<subpath>', '仓库内 skill 子路径').argument('[consumers...]', '消费者列表，默认 agents claude').action((skill, repo, subpath, consumers) => installGit(skill, repo, subpath, consumers?.length ? consumers : ['agents', 'claude']));
program.command('update-git').description('从 Git 仓库更新 skill；默认读取 registry.yaml 中的来源').argument('<skill>', 'skill 名称').argument('[repo]', '可选：覆盖 registry 中的 Git 仓库 URL').argument('[subpath]', '可选：覆盖 registry 中的仓库内子路径').action(updateGit);
program.command('adopt').description('收编被 installer 安装到 view 中的真实目录').argument('<view>', '来源 view：agents 或 claude').argument('<skill>', 'skill 名称').argument('[alsoConsumers...]', '同时暴露给其他消费者').action(adopt);

program.parseAsync(process.argv).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
