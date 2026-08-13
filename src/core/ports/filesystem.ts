export type FileKind = 'file' | 'directory' | 'symlink' | 'other' | 'missing';

export type DirectoryEntry = {
  name: string;
  kind: Exclude<FileKind, 'missing'>;
};

export interface FileSystemPort {
  exists(path: string): boolean;
  readText(path: string): string;
  writeText(path: string, contents: string): void;
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
}
