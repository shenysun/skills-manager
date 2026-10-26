import type { FileSystemPort } from './filesystem.js';
import type { SecurityScanReport } from '../model/index.js';

/**
 * Pluggable skill-tree security scanner (ROADMAP 「装前安全扫描」).
 * Builtin MVP today; a future SkillSpector / third-party adapter implements
 * the same port without changing install/update callers.
 */
export interface SecurityScannerPort {
  readonly id: string;
  scan(fs: FileSystemPort, skillRoot: string, skillName: string): SecurityScanReport;
}
