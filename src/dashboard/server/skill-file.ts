import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { NodeFileSystem } from '../../infra/fs-skill-home.js';
import { errorMessage, SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName } from '../../shared/validation.js';
import { highlightSource, renderMarkdown, stripFrontmatter } from './render-markdown.js';

export const PREVIEW_MAX_BYTES = 512 * 1024;

/** Whitelisted source-language extensions → shiki grammar (spec §渲染管线). */
const SOURCE_EXTENSIONS: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript',
  py: 'python',
  vue: 'vue',
  sh: 'shellscript', bash: 'shellscript',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  toml: 'toml',
  html: 'html',
  css: 'css',
  xml: 'xml',
  sql: 'sql',
};

/** Binary by content, not by name: a NUL byte or undecodable UTF-8. */
function isBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) return true;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return false;
  } catch {
    return true;
  }
}

function extensionOf(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

const fs = new NodeFileSystem();

function forbidden(code: string, message: string): SkillsManagerError {
  return Object.assign(new SkillsManagerError(code, message), { statusCode: 403 });
}

function notFound(code: string, message: string): SkillsManagerError {
  return Object.assign(new SkillsManagerError(code, message), { statusCode: 404 });
}

/** Shared safety gate for both preview endpoints: valid name + existing skill.
 *  403 invalid_skill_name / 404 skill_not_found, mirroring the hub's posture. */
export function previewSkillDir(home: string, name: string): string {
  try {
    assertSafeSkillName(name);
  } catch (error) {
    throw forbidden('invalid_skill_name', errorMessage(error));
  }
  const skillDir = path.join(path.resolve(home, 'skills'), name);
  if (fs.kind(path.join(skillDir, 'SKILL.md')) !== 'file') {
    throw notFound('skill_not_found', `Skill not found: ${name}`);
  }
  return skillDir;
}

/** File entries for the preview tree: sorted relative paths + sizes. Broken
 *  symlinks report size 0 — the tree reflects the directory as it stands. */
export function previewFileEntries(skillDir: string, paths: string[]) {
  return paths.map((relative) => {
    let size = 0;
    try {
      size = statSync(path.join(skillDir, relative)).size;
    } catch {
      size = 0;
    }
    return { path: relative, size };
  });
}

/** Read one file of a hub skill for the preview Sheet (read-only).
 *  Security: skill name validation + path containment on both the lexical and
 *  the real (symlink-resolved) path — same posture as the rest of the hub. */
export async function readSkillFile(home: string, name: string, relativePath: string) {
  const skillDir = previewSkillDir(home, name);

  const absolute = path.resolve(skillDir, relativePath);
  try {
    assertPathInside(absolute, skillDir);
  } catch (error) {
    throw forbidden('path_escape', errorMessage(error));
  }

  let realFile: string;
  try {
    realFile = realpathSync(absolute);
  } catch {
    throw notFound('file_not_found', `File not found: ${name}/${relativePath}`);
  }
  try {
    assertPathInside(realFile, realpathSync(skillDir));
  } catch {
    throw forbidden('path_escape', `Symlink escape blocked: ${name}/${relativePath}`);
  }
  if (fs.targetKind(realFile) !== 'file') {
    throw notFound('file_not_found', `File not found: ${name}/${relativePath}`);
  }

  const buffer = readFileSync(realFile);

  if (isBinary(buffer)) {
    return { kind: 'binary' as const, size: buffer.length };
  }

  const truncated = buffer.length > PREVIEW_MAX_BYTES;
  const content = (truncated ? buffer.subarray(0, PREVIEW_MAX_BYTES) : buffer).toString('utf8');
  const extension = extensionOf(relativePath);

  if (extension === 'md') {
    return {
      kind: 'markdown' as const,
      html: await renderMarkdown(stripFrontmatter(content)),
      raw: content,
      truncated,
    };
  }
  const sourceLang = SOURCE_EXTENSIONS[extension];
  if (sourceLang) {
    return {
      kind: 'source' as const,
      html: await highlightSource(content, sourceLang),
      truncated,
    };
  }
  return { kind: 'text' as const, raw: content, truncated };
}
