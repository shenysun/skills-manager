export type FileKind = 'file' | 'directory' | 'symlink' | 'other' | 'missing';

export type DirectoryEntry = {
  name: string;
  kind: Exclude<FileKind, 'missing'>;
};

export interface FileSystemPort {
  exists(path: string): boolean;
  readText(path: string): string;
  /** Binary read (archive members and zip payloads are not utf-8-safe). */
  readBytes(path: string): Buffer;
  /** File size in bytes; lets callers bound a read before paying for it. */
  size(path: string): number;
  writeText(path: string, contents: string): void;
  /** Binary write; creates parent directories like writeText. */
  writeBytes(path: string, contents: Buffer): void;
  appendText(path: string, contents: string): void;
  readDirectory(path: string): DirectoryEntry[];
  kind(path: string): FileKind;
  targetKind(path: string): FileKind;
  makeDirectory(path: string): void;
  removeFileOrSymlink(path: string): void;
  removeTree(path: string): void;
  copyDirectoryContents(sourceDir: string, destinationDir: string): void;
  move(source: string, destination: string): void;
  symlink(target: string, path: string): void;
  readlink(path: string): string;
  /** Last-modified time in epoch ms; 0 when the path does not exist. */
  modifiedAt(path: string): number;
}

/** The one broken-symlink predicate, so doctor's broken-links report and the
 *  cost ledger's errors section can never silently diverge (ADR-0018, US26). */
export function isBrokenSymlink(fs: FileSystemPort, path: string): boolean {
  return fs.kind(path) === 'symlink' && fs.targetKind(path) === 'missing';
}
