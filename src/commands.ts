import inquirer from 'inquirer';
import { existsSync, lstatSync, renameSync } from 'node:fs';
import { CONSUMERS, parseConsumers, type Consumer } from './types.js';
import { skillDir, skillHomePath } from './paths.js';
import { ensureRegistryEntry, listCanonicalSkills, loadRegistry, saveRegistry, skillExists } from './registry.js';
import { doctor, rebuildCollections, rebuildViews, printSkillList } from './views.js';
import { assertUniqueSkillDestinations, checkoutSource, copySkillToCanonical, discoverSkills, printDiscoveredSkills } from './source.js';
import { run } from './run.js';

export async function confirm(message: string, yes?: boolean) {
  if (yes) return true;
  const ans = await inquirer.prompt([{ type: 'confirm', name: 'ok', message, default: false }]);
  return Boolean(ans.ok);
}

export function listCommand(opts: { consumer?: string; category?: string }) {
  const registry = loadRegistry();
  const consumer = opts.consumer ? parseConsumers([opts.consumer])[0] : undefined;
  const rows = Object.entries(registry.skills || {})
    .filter(([skill, entry]) => skillExists(skill) && (!consumer || (entry.consumers || []).includes(consumer)) && (!opts.category || entry.category === opts.category))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([skill, entry]) => [skill, entry.category || 'experimental', (entry.consumers || []).join(', ') || '-'] as [string, string, string]);
  printSkillList(rows);
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

export function expose(skill: string, values: string[]) {
  const registry = loadRegistry();
  const current = registry.skills[skill]?.consumers || [];
  setConsumers(skill, parseConsumers([...current, ...values]));
}

export function hide(skill: string, values: string[]) {
  const consumers = parseConsumers(values);
  const registry = loadRegistry();
  const current = registry.skills[skill]?.consumers || [];
  setConsumers(skill, current.filter((consumer) => !consumers.includes(consumer)));
}

export async function addFromSource(source: string, opts: { list?: boolean; all?: boolean; skill?: string[]; consumer?: string[]; yes?: boolean }) {
  const sourceInfo = checkoutSource(source);
  const discovered = discoverSkills(sourceInfo);
  if (discovered.length === 0) throw new Error('没有在该来源中发现 SKILL.md');

  if (opts.list) {
    printDiscoveredSkills(discovered);
    return;
  }

  let selected = discovered;
  if (!opts.all && opts.skill && opts.skill.length > 0) {
    const requested = new Set(opts.skill);
    selected = discovered.filter((skill) => requested.has(skill.name) || requested.has(skill.subpath));
    const missing = [...requested].filter((name) => !selected.some((skill) => skill.name === name || skill.subpath === name));
    if (missing.length > 0) throw new Error(`未找到指定 skill：${missing.join(', ')}`);
  } else if (!opts.all) {
    const ans = await inquirer.prompt([{
      type: 'checkbox',
      name: 'skills',
      message: '选择要安装的 skills',
      choices: discovered.map((skill) => ({
        name: `${skill.name}  (${skill.subpath})${skill.description ? ` - ${skill.description}` : ''}`,
        value: skill.subpath,
      })),
      validate: (value) => value.length > 0 || '至少选择一个 skill',
    }]);
    const selectedSubpaths = new Set(ans.skills as string[]);
    selected = discovered.filter((skill) => selectedSubpaths.has(skill.subpath));
  }

  assertUniqueSkillDestinations(selected);

  let consumers = opts.consumer && opts.consumer.length > 0 ? parseConsumers(opts.consumer) : undefined;
  if (!consumers) {
    const ans = await inquirer.prompt([{
      type: 'checkbox',
      name: 'consumers',
      message: '选择消费者',
      choices: [...CONSUMERS],
      default: [...CONSUMERS],
      validate: (value) => value.length > 0 || '至少选择一个消费者',
    }]);
    consumers = parseConsumers(ans.consumers);
  }

  const existing = selected.filter((skill) => existsSync(skillDir(skill.name)));
  if (existing.length > 0 && !(await confirm(`以下 skill 已存在，将覆盖更新：${existing.map((skill) => skill.name).join(', ')}。继续吗？`, opts.yes))) return;

  for (const skill of selected) copySkillToCanonical(skill, sourceInfo, consumers);
  rebuildViews();
  rebuildCollections();
  printDiscoveredSkills(selected);
  console.log(`已安装 ${selected.length} 个 skill。下一步建议运行：skills doctor && git diff`);
}

export function updateGit(skill: string, repo?: string, subpath?: string) {
  const registry = loadRegistry();
  const entry = registry.skills[skill];
  if (!entry) throw new Error(`registry.yaml 中找不到条目：${skill}`);
  const finalRepo = repo || entry.source?.url;
  const finalSubpath = subpath || entry.source?.subpath;
  if (!finalRepo || !finalSubpath) throw new Error(`缺少 repo/subpath：${skill}`);
  const sourceInfo = checkoutSource(finalRepo, entry.source?.ref || undefined);
  const absoluteDir = `${sourceInfo.repoDir}/${finalSubpath}`;
  const discovered = [{
    name: skill,
    title: entry.title || skill,
    description: entry.description || '',
    subpath: finalSubpath,
    absoluteDir,
  }];
  copySkillToCanonical(discovered[0], { ...sourceInfo, ref: entry.source?.ref || sourceInfo.ref }, entry.consumers || [...CONSUMERS]);
  console.log(`已更新 ${skill}；来源：${finalRepo}；版本：${sourceInfo.commit}`);
}

export function installGitDeprecated(skill: string, repo: string, subpath: string, values: string[]) {
  const consumers = parseConsumers(values, [...CONSUMERS]);
  const sourceInfo = checkoutSource(repo);
  copySkillToCanonical({ name: skill, title: skill, description: '', subpath, absoluteDir: `${sourceInfo.repoDir}/${subpath}` }, sourceInfo, consumers);
  rebuildViews();
  rebuildCollections();
  console.log(`已安装 ${skill}；来源：${repo}；版本：${sourceInfo.commit}`);
}

export function adopt(view: string, skill: string, also: string[] = []) {
  const [fromView] = parseConsumers([view]);
  const consumers = parseConsumers([fromView, ...also]);
  const src = skillHomePath('views', fromView, skill);
  const dst = skillDir(skill);
  if (!existsSync(src) || lstatSync(src).isSymbolicLink()) throw new Error(`${src} 必须是安装在 view 中的真实目录`);
  if (existsSync(dst)) throw new Error(`canonical skill 已存在：${dst}`);
  renameSync(src, dst);
  ensureRegistryEntry(skill, { consumers, source: { type: 'local', url: null, subpath: null, ref: null, upstream_commit: null } });
  rebuildViews();
  rebuildCollections();
  console.log(`已收编 ${skill} 到 ${dst}`);
}

export async function menu() {
  const choices = [
    { name: '健康检查', value: 'doctor' },
    { name: '列出 skills', value: 'list' },
    { name: '重建 views', value: 'rebuild views' },
    { name: '重建 collections', value: 'rebuild collections' },
    { name: '暴露 skill 给消费者', value: 'expose skill' },
    { name: '隐藏 skill', value: 'hide skill' },
    { name: '从 URL/Git 发现并安装 skill', value: 'add from source' },
    { name: '从 Git 更新 skill', value: 'update from git' },
    { name: '查看 Git 状态', value: 'git status' },
    { name: '退出', value: 'quit' },
  ];
  while (true) {
    const { action } = await inquirer.prompt([{ type: 'select', name: 'action', message: '请选择 skills 操作', choices }]);
    try {
      if (action === 'quit') return;
      if (action === 'doctor') doctor();
      if (action === 'list') listCommand({});
      if (action === 'rebuild views') { rebuildViews(); console.log('views 已重建'); }
      if (action === 'rebuild collections') { rebuildCollections(); console.log('collections 已重建'); }
      if (action === 'git status') run('git', ['status']);
      if (action === 'expose skill' || action === 'hide skill') {
        const skills = listCanonicalSkills();
        const ans = await inquirer.prompt([
          { type: 'select', name: 'skill', message: '选择 skill', choices: skills },
          { type: 'checkbox', name: 'consumers', message: '选择消费者', choices: [...CONSUMERS], validate: (value) => value.length > 0 || '至少选择一个消费者' },
        ]);
        if (action === 'expose skill') expose(ans.skill, ans.consumers);
        else hide(ans.skill, ans.consumers);
      }
      if (action === 'add from source') {
        const ans = await inquirer.prompt([{ type: 'input', name: 'source', message: '输入 Git URL、GitHub owner/repo 或本地路径' }]);
        await addFromSource(ans.source, {});
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
