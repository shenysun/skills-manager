import inquirer from 'inquirer';
import { existsSync, lstatSync, renameSync } from 'node:fs';
import path from 'node:path';
import { table } from 'table';
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



export function discoverFromSource(source: string) {
  const sourceInfo = checkoutSource(source);
  const discovered = discoverSkills(sourceInfo);
  return { sourceInfo, discovered };
}

export async function installFromSourceSelection(source: string, subpaths: string[], consumerValues: string[], opts: { yes?: boolean } = {}) {
  const { sourceInfo, discovered } = discoverFromSource(source);
  const requested = new Set(subpaths);
  const selected = discovered.filter((skill) => requested.has(skill.subpath) || requested.has(skill.name));
  const missing = [...requested].filter((value) => !selected.some((skill) => skill.subpath === value || skill.name === value));
  if (missing.length > 0) throw new Error(`未找到指定 skill：${missing.join(', ')}`);
  assertUniqueSkillDestinations(selected);
  const consumers = parseConsumers(consumerValues, [...CONSUMERS]);
  const existing = selected.filter((skill) => existsSync(skillDir(skill.name)));
  if (existing.length > 0 && !(await confirm(`以下 skill 已存在，将覆盖更新：${existing.map((skill) => skill.name).join(', ')}。继续吗？`, opts.yes))) return [];
  for (const skill of selected) copySkillToCanonical(skill, sourceInfo, consumers);
  rebuildViews();
  rebuildCollections();
  return selected;
}

type UpdateCandidate = {
  skill: string;
  url: string;
  subpath: string;
  ref?: string;
  title: string;
  description: string;
  consumers: Consumer[];
};

type SourceGroup = {
  key: string;
  url: string;
  ref?: string;
  skills: UpdateCandidate[];
};

export function updateCandidatesFromRegistry(): UpdateCandidate[] {
  const registry = loadRegistry();
  const candidates: UpdateCandidate[] = [];
  for (const [skill, entry] of Object.entries(registry.skills || {})) {
    if (!skillExists(skill)) continue;
    const url = entry.source?.url;
    const subpath = entry.source?.subpath;
    if (!url || !subpath) continue;
    candidates.push({
      skill,
      url,
      subpath,
      ref: entry.source?.ref || undefined,
      title: entry.title || skill,
      description: entry.description || '',
      consumers: entry.consumers && entry.consumers.length > 0 ? parseConsumers(entry.consumers) : [...CONSUMERS],
    });
  }
  return candidates.sort((a, b) => a.skill.localeCompare(b.skill));
}

function sourceKey(url: string, ref?: string) {
  return `${url}#${ref || ''}`;
}

export function groupUpdateCandidates(candidates: UpdateCandidate[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const candidate of candidates) {
    const key = sourceKey(candidate.url, candidate.ref);
    const group = groups.get(key) || { key, url: candidate.url, ref: candidate.ref, skills: [] };
    group.skills.push(candidate);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.url.localeCompare(b.url) || (a.ref || '').localeCompare(b.ref || ''));
}

export function printUpdatePlan(candidates: UpdateCandidate[]) {
  console.log(table([
    ['Skill', '来源', '路径'],
    ...candidates.map((candidate) => [
      candidate.skill,
      candidate.ref ? `${candidate.url}#${candidate.ref}` : candidate.url,
      candidate.subpath,
    ]),
  ], {
    columns: {
      0: { alignment: 'left' },
      1: { alignment: 'left', width: 64, wrapWord: true },
      2: { alignment: 'left' },
    },
    drawHorizontalLine: (lineIndex, rowCount) => lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
  }).trimEnd());
}

export async function updateRegistrySkills(candidates: UpdateCandidate[], opts: { yes?: boolean } = {}) {
  if (candidates.length === 0) throw new Error('没有可更新的 skill。请检查 registry.yaml 中是否有 source.url 和 source.subpath。');
  printUpdatePlan(candidates);
  if (!(await confirm(`确认更新 ${candidates.length} 个 skill 吗？`, opts.yes))) return;

  for (const group of groupUpdateCandidates(candidates)) {
    const sourceInfo = checkoutSource(group.url, group.ref);
    for (const candidate of group.skills) {
      copySkillToCanonical({
        name: candidate.skill,
        title: candidate.title,
        description: candidate.description,
        subpath: candidate.subpath,
        absoluteDir: path.join(sourceInfo.repoDir, candidate.subpath),
      }, { ...sourceInfo, ref: candidate.ref || sourceInfo.ref }, candidate.consumers);
      console.log(`已更新 ${candidate.skill}；来源：${group.url}${candidate.ref ? `#${candidate.ref}` : ''}；版本：${sourceInfo.commit}`);
    }
  }

  rebuildViews();
  rebuildCollections();
}

export async function updateBySkillNames(skillNames: string[], opts: { yes?: boolean } = {}) {
  const byName = new Map(updateCandidatesFromRegistry().map((candidate) => [candidate.skill, candidate]));
  const missing = skillNames.filter((skill) => !byName.has(skill));
  if (missing.length > 0) throw new Error(`这些 skill 没有可用 registry 来源：${missing.join(', ')}`);
  await updateRegistrySkills(skillNames.map((skill) => byName.get(skill)!), opts);
}

export async function updateMenu() {
  const candidates = updateCandidatesFromRegistry();
  if (candidates.length === 0) throw new Error('没有可更新的 skill。请先在 registry.yaml 中补充 source.url 和 source.subpath。');

  const { mode } = await inquirer.prompt([{ type: 'select', name: 'mode', message: '选择更新方式', choices: [
    { name: '更新某一个 skill（从注册表来源）', value: 'one' },
    { name: '批量选择 skills 更新（从注册表来源）', value: 'many' },
    { name: '按来源仓库更新（自动匹配同仓库已安装 skills）', value: 'source' },
    { name: '输入 URL/Git 来源，发现后选择安装/覆盖', value: 'add' },
    { name: '返回', value: 'back' },
  ] }]);

  if (mode === 'back') return;
  if (mode === 'add') {
    const ans = await inquirer.prompt([{ type: 'input', name: 'source', message: '输入 Git URL、GitHub owner/repo 或本地路径' }]);
    await addFromSource(ans.source, {});
    return;
  }

  if (mode === 'one') {
    const ans = await inquirer.prompt([{ type: 'select', name: 'skill', message: '选择要更新的 skill', choices: candidates.map((candidate) => ({
      name: `${candidate.skill}  (${candidate.url}${candidate.ref ? `#${candidate.ref}` : ''} / ${candidate.subpath})`,
      value: candidate.skill,
    })) }]);
    await updateBySkillNames([ans.skill]);
    return;
  }

  if (mode === 'many') {
    const ans = await inquirer.prompt([{ type: 'checkbox', name: 'skills', message: '选择要批量更新的 skills', choices: candidates.map((candidate) => ({
      name: `${candidate.skill}  (${candidate.url}${candidate.ref ? `#${candidate.ref}` : ''} / ${candidate.subpath})`,
      value: candidate.skill,
    })), validate: (value) => value.length > 0 || '至少选择一个 skill' }]);
    await updateBySkillNames(ans.skills);
    return;
  }

  if (mode === 'source') {
    const groups = groupUpdateCandidates(candidates);
    const ans = await inquirer.prompt([{ type: 'select', name: 'source', message: '选择来源仓库', choices: groups.map((group) => ({
      name: `${group.url}${group.ref ? `#${group.ref}` : ''}  (${group.skills.length} 个：${group.skills.map((skill) => skill.skill).join(', ')})`,
      value: group.key,
    })) }]);
    const group = groups.find((item) => item.key === ans.source);
    if (!group) throw new Error(`找不到来源：${ans.source}`);
    const picked = await inquirer.prompt([{ type: 'checkbox', name: 'skills', message: '选择该来源下要更新的 skills', choices: group.skills.map((candidate) => ({
      name: `${candidate.skill}  (${candidate.subpath})`,
      value: candidate.skill,
      checked: true,
    })), validate: (value) => value.length > 0 || '至少选择一个 skill' }]);
    await updateBySkillNames(picked.skills);
  }
}

export async function updateGit(skill: string, repo?: string, subpath?: string) {
  if (!repo && !subpath) {
    await updateBySkillNames([skill], { yes: true });
    return;
  }

  const registry = loadRegistry();
  const entry = registry.skills[skill];
  if (!entry) throw new Error(`registry.yaml 中找不到条目：${skill}`);
  const finalRepo = repo || entry.source?.url;
  const finalSubpath = subpath || entry.source?.subpath;
  if (!finalRepo || !finalSubpath) throw new Error(`缺少 repo/subpath：${skill}`);
  const sourceInfo = checkoutSource(finalRepo, entry.source?.ref || undefined);
  copySkillToCanonical({
    name: skill,
    title: entry.title || skill,
    description: entry.description || '',
    subpath: finalSubpath,
    absoluteDir: path.join(sourceInfo.repoDir, finalSubpath),
  }, { ...sourceInfo, ref: entry.source?.ref || sourceInfo.ref }, entry.consumers || [...CONSUMERS]);
  rebuildViews();
  rebuildCollections();
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
    { name: '更新 skills（单个 / 批量 / 按来源）', value: 'update skills' },
    { name: '从 URL/Git 发现并安装 skill', value: 'add from source' },
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
      if (action === 'update skills') {
        await updateMenu();
      }
      if (action === 'add from source') {
        const ans = await inquirer.prompt([{ type: 'input', name: 'source', message: '输入 Git URL、GitHub owner/repo 或本地路径' }]);
        await addFromSource(ans.source, {});
      }
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
    }
  }
}
