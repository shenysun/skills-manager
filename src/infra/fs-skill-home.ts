import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import type { DirectoryEntry, FileKind, FileSystemPort } from '../core/ports/filesystem.js';

export class NodeFileSystem implements FileSystemPort {
  exists(filePath: string): boolean {
    return existsSync(filePath);
  }

  readText(filePath: string): string {
    return readFileSync(filePath, 'utf8');
  }

  writeText(filePath: string, contents: string): void {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, contents);
  }

  appendText(filePath: string, contents: string): void {
    mkdirSync(path.dirname(filePath), { recursive: true });
    appendFileSync(filePath, contents);
  }

  readDirectory(dirPath: string): DirectoryEntry[] {
    return readdirSync(dirPath, { withFileTypes: true }).map((entry) => ({ name: entry.name, kind: this.direntKind(entry) }));
  }

  kind(filePath: string): FileKind {
    try {
      const st = lstatSync(filePath);
      if (st.isSymbolicLink()) return 'symlink';
      if (st.isDirectory()) return 'directory';
      if (st.isFile()) return 'file';
      return 'other';
    } catch {
      return 'missing';
    }
  }

  targetKind(filePath: string): FileKind {
    try {
      const st = statSync(filePath);
      if (st.isDirectory()) return 'directory';
      if (st.isFile()) return 'file';
      return 'other';
    } catch {
      return 'missing';
    }
  }

  makeDirectory(dirPath: string): void {
    mkdirSync(dirPath, { recursive: true });
  }

  removeFileOrSymlink(filePath: string): void {
    rmSync(filePath, { force: true });
  }

  copyDirectoryContents(sourceDir: string, destinationDir: string): void {
    mkdirSync(destinationDir, { recursive: true });
    rmSync(destinationDir, { recursive: true, force: true });
    mkdirSync(destinationDir, { recursive: true });
    cpSync(sourceDir, destinationDir, { recursive: true, dereference: false, force: true, verbatimSymlinks: true });
  }

  move(source: string, destination: string): void {
    mkdirSync(path.dirname(destination), { recursive: true });
    renameSync(source, destination);
  }

  symlink(target: string, filePath: string): void {
    symlinkSync(target, filePath);
  }

  readlink(filePath: string): string {
    return readlinkSync(filePath);
  }

  private direntKind(entry: import('node:fs').Dirent): Exclude<FileKind, 'missing'> {
    if (entry.isSymbolicLink()) return 'symlink';
    if (entry.isDirectory()) return 'directory';
    if (entry.isFile()) return 'file';
    return 'other';
  }
}

export function createNodeFileSystem() {
  return new NodeFileSystem();
}
