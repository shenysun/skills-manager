import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { NodeFileSystem } from '../../infra/fs-skill-home.js';
import { errorMessage, SkillsManagerError } from '../../shared/errors.js';
import { assertPathInside, assertSafeSkillName } from '../../shared/validation.js';
import { renderMarkdown, stripFrontmatter } from './render-markdown.js';

export const PREVIEW_MAX_BYTES = 512 * 1024;

const fs = new NodeFileSystem();

function forbidden(code: string, message: string): SkillsManagerError {
  return Object.assign(new SkillsManagerError(code, message), { statusCode: 403 });
}

function notFound(code: string, message: string): SkillsManagerError {
  return Object.assign(new SkillsManagerError(code, message), { statusCode: 404 });
}

/** Read one file of a hub skill for the preview Sheet (read-only).
 *  Security: skill name validation + path containment on both the lexical and
 *  the real (symlink-resolved) path — same posture as the rest of the hub. */
export async function readSkillFile(home: string, name: string, relativePath: string) {
  try {
    assertSafeSkillName(name);
  } catch (error) {
    throw forbidden('invalid_skill_name', errorMessage(error));
  }

  const skillsDir = path.resolve(home, 'skills');
  const skillDir = path.join(skillsDir, name);
  if (fs.kind(path.join(skillDir, 'SKILL.md')) !== 'file') {
    throw notFound('skill_not_found', `Skill not found: ${name}`);
  }

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
  const truncated = buffer.length > PREVIEW_MAX_BYTES;
  const content = (truncated ? buffer.subarray(0, PREVIEW_MAX_BYTES) : buffer).toString('utf8');

  if (relativePath.toLowerCase().endsWith('.md')) {
    return {
      kind: 'markdown' as const,
      html: await renderMarkdown(stripFrontmatter(content)),
      raw: content,
      truncated,
    };
  }
  // 02 lands the source/text/binary kinds; until then non-markdown files are
  // explicitly unsupported rather than silently guessed.
  throw notFound('file_kind_unsupported', `Preview for ${name}/${relativePath} is not supported yet`);
}
