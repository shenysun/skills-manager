import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, statSync, symlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { table } from 'table';
import { assertSkillHome, liveSkillPath, lstatExists, relativeToSkillHome, skillHomePath } from './paths.js';
import { loadRegistry, listCanonicalSkills, skillExists } from './registry.js';
import { run } from './run.js';
import { CONSUMERS, type Consumer } from './types.js';

function safeClearSymlinkDir(dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const child of readdirSync(dir)) {
    const full = path.join(dir, child);
    const st = lstatSync(full);
    if (st.isSymbolicLink() || st.isFile()) unlinkSync(full);
    else if (st.isDirectory()) throw new Error(`拒绝删除 view/collection 中的真实目录：${full}。请先执行 adopt 收编。`);
  }
}

function linkView(consumer: Consumer, skill: string) {
  const dir = skillHomePath('views', consumer);
  mkdirSync(dir, { recursive: true });
  const target = path.join(dir, skill);
  if (existsSync(target) || lstatExists(target)) {
    const st = lstatSync(target);
    if (!st.isSymbolicLink() && !st.isFile()) throw new Error(`拒绝替换真实目录：${target}`);
    unlinkSync(target);
  }
  symlinkSync(path.join('..', '..', 'skills', skill), target);
}

export function rebuildViews() {
  const registry = loadRegistry();
  for (const consumer of CONSUMERS) safeClearSymlinkDir(skillHomePath('views', consumer));
  for (const [skill, entry] of Object.entries(registry.skills || {})) {
    if (!skillExists(skill)) continue;
    for (const consumer of entry.consumers || []) {
      if (consumer === 'agents' || consumer === 'claude') linkView(consumer, skill);
    }
  }
}

export function rebuildCollections() {
  const registry = loadRegistry();
  const root = skillHomePath('collections');
  mkdirSync(root, { recursive: true });
  for (const item of readdirSync(root)) {
    const full = path.join(root, item);
    const st = lstatSync(full);
    if (st.isSymbolicLink() || st.isFile()) unlinkSync(full);
    else if (st.isDirectory()) {
      for (const child of readdirSync(full)) {
        const childPath = path.join(full, child);
        const childStat = lstatSync(childPath);
        if (childStat.isSymbolicLink() || childStat.isFile()) unlinkSync(childPath);
        else throw new Error(`拒绝删除 collection 中的真实目录：${childPath}`);
      }
    }
  }
  for (const [skill, entry] of Object.entries(registry.skills || {})) {
    if (!skillExists(skill)) continue;
    const category = entry.category || 'experimental';
    const dir = skillHomePath('collections', category);
    mkdirSync(dir, { recursive: true });
    const link = path.join(dir, skill);
    if (!lstatExists(link)) symlinkSync(path.join('..', '..', 'skills', skill), link);
  }
}

function countLinks(dir: string) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((item) => lstatSync(path.join(dir, item)).isSymbolicLink()).length;
}

function readlinkSafe(file: string) {
  try { return os.platform() === 'win32' ? file : readlinkSync(file); } catch { return '?'; }
}

export function doctor() {
  assertSkillHome();
  const skills = listCanonicalSkills();
  const broken: string[] = [];
  for (const base of [skillHomePath('views'), skillHomePath('collections')]) {
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
  console.log(`Skill 根目录：${skillHomePath()}`);
  console.log(`Canonical skills 数量：${skills.length}`);
  console.log(`Agents view 链接数：${countLinks(skillHomePath('views', 'agents'))}`);
  console.log(`Claude view 链接数：${countLinks(skillHomePath('views', 'claude'))}`);
  console.log(`损坏软链接数：${broken.length}`);
  for (const b of broken) console.log(`  ${relativeToSkillHome(b)}`);
  for (const consumer of CONSUMERS) {
    const live = liveSkillPath(consumer);
    if (lstatExists(live) && lstatSync(live).isSymbolicLink()) console.log(`${consumer} 线上入口：软链接 -> ${readlinkSafe(live)}`);
    else if (existsSync(live)) console.log(`${consumer} 线上入口：尚未切换，当前仍是真实目录 ${live}`);
    else console.log(`${consumer} 线上入口：缺失 ${live}`);
  }
  const status = run('git', ['status', '--short'], { quiet: true });
  console.log(status ? `Git 状态：\n${status}` : 'Git 状态：干净');
}

export function printSkillList(rows: Array<[string, string, string]>) {
  console.log(table([
    ['Skill', '分类', '消费者'],
    ...rows,
  ], {
    columns: { 0: { alignment: 'left' }, 1: { alignment: 'left' }, 2: { alignment: 'left' } },
    drawHorizontalLine: (lineIndex, rowCount) => lineIndex === 0 || lineIndex === 1 || lineIndex === rowCount,
  }).trimEnd());
}
