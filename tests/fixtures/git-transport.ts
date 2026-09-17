import { cpSync } from 'node:fs';
import type { GitCloneOptions, GitPort } from '../../src/core/ports/git.js';
import { inertSyncGit } from './spy-git.js';

export const FAKE_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
export const FAKE_TREE = '0123456789abcdef0123456789abcdef01234567';

/**
 * Fake transport: "clone" materializes an upstream working tree — a shallow
 * clone has no history to fake. The anchors answer with fixed fakes.
 */
export function materializingGit(upstream: string): GitPort {
  return {
    clone: (_repoUrl: string, destination: string, _options?: GitCloneOptions) => cpSync(upstream, destination, { recursive: true }),
    revParseHead: () => FAKE_COMMIT,
    revParseTree: () => FAKE_TREE,
    listRemoteHeads: () => [],
    statusShort: () => '',
    log: () => [],
    ...inertSyncGit(),
    commit: () => FAKE_COMMIT,
  };
}
