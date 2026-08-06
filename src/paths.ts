import os from 'node:os';
import path from 'node:path';
import { existsSync, lstatSync } from 'node:fs';
import type { Consumer } from './types.js';

export const HOME = os.homedir();
export const DEFAULT_SKILL_HOME = path.join(HOME, 'Documents/Cheese/ai/agent-skills');
export const SKILL_HOME = process.env.SKILL_HOME || DEFAULT_SKILL_HOME;

export function skillHomePath(...parts: string[]) {
  return path.join(SKILL_HOME, ...parts);
}

export function relativeToSkillHome(abs: string) {
  return path.relative(SKILL_HOME, abs) || '.';
}

export function assertSkillHome() {
  if (!existsSync(SKILL_HOME)) throw new Error(`SKILL_HOME 不存在：${SKILL_HOME}`);
}

export function registryPath() {
  return skillHomePath('registry.yaml');
}

export function canonicalSkillsDir() {
  return skillHomePath('skills');
}

export function assertSafeSkillName(name: string) {
  if (!name || name === '.' || name === '..') throw new Error(`非法 skill 名称：${name}`);
  if (name.includes('/') || name.includes('\\')) throw new Error(`skill 名称不能包含路径分隔符：${name}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`非法 skill 名称：${name}。只允许字母、数字、点、下划线和短横线，且必须以字母或数字开头。`);
  }
}

export function assertPathInside(child: string, parent: string) {
  const resolvedChild = path.resolve(child);
  const resolvedParent = path.resolve(parent);
  if (resolvedChild !== resolvedParent && !resolvedChild.startsWith(resolvedParent + path.sep)) {
    throw new Error(`路径逃逸被拦截：${resolvedChild} 不在 ${resolvedParent} 内`);
  }
}

export function skillDir(skill: string) {
  assertSafeSkillName(skill);
  const dir = path.resolve(canonicalSkillsDir(), skill);
  assertPathInside(dir, canonicalSkillsDir());
  return dir;
}

export function lstatExists(file: string) {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

export function liveSkillPath(consumer: Consumer) {
  return consumer === 'agents' ? path.join(HOME, '.agents', 'skills') : path.join(HOME, '.claude', 'skills');
}
